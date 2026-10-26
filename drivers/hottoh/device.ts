import Homey from 'homey';
import net from 'net';
import { Hottoh } from 'hottohts';
import { getStateId } from './stove-state';

/**
 * HottohDevice Class
 *
 * This class implements the device driver for HottoH pellet stoves.
 * It handles:
 * - Connection to the stove via the HottoH API
 * - Setting and getting stove state (on/off, temperature, fan speed, etc.)
 * - Periodic polling of stove state
 * - Handling capabilities (power level, temperature, fan speed)
 * - Triggering flow cards based on stove state changes
 * - Managing settings changes
 */

// Define the interface for our custom driver to resolve TypeScript errors
interface HottohDriver extends Homey.Driver {
  triggerStoveStateChanged(device: any, tokens: any, state: any): Promise<void>;
  triggerTemperatureReached(device: any, tokens: any, state: any): Promise<void>;
  triggerSmokeTemperatureThreshold(device: any, tokens: any, state: any): Promise<void>;
  triggerWifiSignalChanged(device: any, tokens: any, state: any): Promise<void>;
  triggerPowerLevelChanged(device: any, tokens: any, state: any): Promise<void>;
}

interface HottohApp extends Homey.App {
  triggerAnyStoveOn(device: any, value: boolean): Promise<void>;
}

const TURN_OFF_WHEN_REACHED_KEY = 'turnOffWhenTemperatureReached';
const MAX_TEXT_LENGTH = 64;

/**
 * Stove-provided text is shown in the UI and passed to flows; strip control characters and cap the length.
 */
function sanitizeText(value: string | null): string | null {
  if (value === null) return null;
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_TEXT_LENGTH);
}

module.exports = class HottohDevice extends Homey.Device {
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 5000; // 5 seconds
  private readonly DEFAULT_PORT = 5001; // Default port for HottoH stoves
  private readonly CONNECT_TIMEOUT = 15000;
  private readonly MAX_RECONNECT_DELAY = 300000; // 5 minutes
  private readonly STALE_CONNECTION_THRESHOLD = 30000; // 30 seconds
  private stoveClient: Hottoh | null = null;
  // IP of the current connection; settings are only saved after onSettings returns
  private currentIp: string | null = null;

  private reconnectAttempts: number = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  // Store previous values for trigger detection
  private prevStoveState: string | null = null;
  private prevIsOn: boolean | null = null;
  private prevPowerLevel: number | null = null;
  private prevWifiSignal: number | null = null;
  private prevSmokeTemperature: number | null = null;
  private temperatureReachedTriggered: boolean = false;

  // Access the driver with the correct type
  private get hottohDriver(): HottohDriver {
    return this.driver as HottohDriver;
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('HottoH Device has been initialized');

    // Register capability listeners
    this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
    this.registerCapabilityListener('target_temperature', this.onCapabilityTargetTemperature.bind(this));
    this.registerCapabilityListener('power_level', this.onCapabilityPowerLevel.bind(this));
    this.registerCapabilityListener('fan_speed', this.onCapabilityFanSpeed.bind(this));

    // Get IP from settings
    const settings = this.getSettings();
    let ip: string | undefined = settings.ipAddress;
    const ipFromStore = this.getStoreValue('address');

    // If we have an IP in store but not settings, migrate it
    if (!ip && ipFromStore) {
      await this.setSettings({ ipAddress: ipFromStore });
      this.log('Migrated IP address from store to settings:', ipFromStore);
      ip = ipFromStore;
    }

    // Initialize previous values from current capability values so a restart doesn't fire triggers
    this.prevStoveState = this.getCapabilityValue('stove_state');
    this.prevIsOn = this.getCapabilityValue('onoff');
    this.prevPowerLevel = this.getCapabilityValue('power_level');
    this.prevWifiSignal = this.getCapabilityValue('wifi_signal');
    this.prevSmokeTemperature = this.getCapabilityValue('smoke_temperature');

    if (!ip) {
      this.log('No IP address found in device settings. Please set the IP address in device settings.');
      await this.setUnavailable('IP address not set. Please configure the device settings.');
      return;
    }

    await this.startPolling(ip);
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings, newSettings, changedKeys }: {
    oldSettings: { [key: string]: any };
    newSettings: { [key: string]: any };
    changedKeys: string[];
  }): Promise<string | void> {
    if (!changedKeys.includes('ipAddress')) return undefined;

    const ip = String(newSettings.ipAddress ?? '').trim();
    if (!net.isIPv4(ip)) {
      throw new Error(`"${ip}" is not a valid IPv4 address. Enter an address such as 192.168.1.50.`);
    }

    this.log(`IP address changed from ${oldSettings.ipAddress} to ${ip}`);
    this.reconnectAttempts = 0;

    if (await this.startPolling(ip)) {
      return 'Successfully connected to stove at new IP address';
    }
    return `Saved, but the stove at ${ip} did not respond yet. Retrying in the background.`;
  }

  /**
   * Connect to the stove and start polling.
   * On failure, schedules a reconnect with exponential backoff.
   * @returns true if the stove responded
   */
  private async startPolling(ip: string): Promise<boolean> {
    this.stopPolling(); // Stop any existing polling
    this.currentIp = ip;

    const client = new Hottoh(ip, this.DEFAULT_PORT);
    this.stoveClient = client;

    try {
      await client.connect(this.CONNECT_TIMEOUT);
    } catch (error) {
      // A newer startPolling() or stopPolling() replaced this client while connecting
      if (this.stoveClient !== client) return false;

      this.error(`Failed to connect to stove at ${ip}:`, error);
      this.stopPolling();
      this.scheduleReconnect();
      return false;
    }
    if (this.stoveClient !== client) return false;

    this.reconnectAttempts = 0;
    this.log(`Connected to stove at ${ip}`);

    await this.applyCapabilityOptions(client);

    // The client reconnects on its own after this point; polling only reads its cached data
    this.updateInterval = this.homey.setInterval(() => this.pollDeviceState(), this.POLL_INTERVAL);
    await this.pollDeviceState();
    return true;
  }

  private async applyCapabilityOptions(client: Hottoh) {
    try {
      await this.setCapabilityOptions('power_level', {
        min: client.getSetMinPowerLevel() ?? 1,
        max: client.getSetMaxPowerLevel() ?? 5,
        step: 1,
      });

      await this.setCapabilityOptions('fan_speed', {
        min: 1,
        max: 5, // 1-4 are manual speeds, 5 is auto mode
        step: 1,
      });
    } catch (error) {
      this.error('Failed to set capability options:', error);
    }
  }

  /**
   * Update capabilities from the client's cached data, or mark the device unavailable if it is stale
   */
  private async pollDeviceState() {
    const client = this.stoveClient;
    if (!client) return;

    const lastData = client.getLastDataTime();
    if (lastData === null || Date.now() - lastData > this.STALE_CONNECTION_THRESHOLD) {
      if (this.getAvailable()) {
        this.log('No fresh data from stove, marking unavailable while the client reconnects');
        await this.setUnavailable('Connection to the stove lost. Reconnecting...').catch((err) => this.error(err));
      }
      return;
    }

    try {
      await this.updateDeviceState(client);
      if (!this.getAvailable()) await this.setAvailable();
    } catch (error) {
      this.error('Error updating device state:', error);
    }
  }

  /**
   * Schedule reconnection with exponential backoff: 2s, 4s, 8s, ... up to 5 minutes, without giving up
   */
  private scheduleReconnect() {
    if (this.reconnectTimeout) {
      this.homey.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    const ip = this.currentIp;
    if (!ip) return;

    const delay = Math.min(2 ** (this.reconnectAttempts + 1) * 1000, this.MAX_RECONNECT_DELAY);
    this.reconnectAttempts++;

    this.log(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);
    this.setUnavailable(`Unable to reach the stove at ${ip}. Retrying in ${Math.round(delay / 1000)} s.`).catch((err) => this.error(err));

    this.reconnectTimeout = this.homey.setTimeout(() => {
      this.reconnectTimeout = null;
      this.startPolling(ip).catch((err) => this.error(err));
    }, delay);
  }

  /**
   * Stop polling, cancel pending reconnects and dispose the connection
   */
  private stopPolling() {
    if (this.updateInterval) {
      this.homey.clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.reconnectTimeout) {
      this.homey.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.stoveClient) {
      this.stoveClient.dispose();
      this.stoveClient = null;
      this.log('Disposed stove connection');
    }
  }

  /**
   * Set a capability value, skipping missing (null) and unchanged values
   */
  private async updateCapability(capabilityId: string, value: any) {
    if (value === null || value === undefined) return;
    if (this.getCapabilityValue(capabilityId) === value) return;
    await this.setCapabilityValue(capabilityId, value);
  }

  /**
   * Update the device state with latest values from the stove and fire triggers on changes
   */
  private async updateDeviceState(client: Hottoh) {
    const isOn = client.getIsOn();
    const roomTemp = client.getTemperatureRoom1();
    const targetTemp = client.getSetTemperatureRoom1();
    const smokeTemp = client.getSmokeTemperature();
    const powerLevel = client.getPowerLevel();
    const wifiRaw = client._getWifiSignal();
    const wifiSignal = wifiRaw !== null && Number.isFinite(parseInt(wifiRaw, 10)) ? parseInt(wifiRaw, 10) : null;
    const stoveState = sanitizeText(client._getStoveState());

    await this.updateCapability('onoff', isOn);
    await this.updateCapability('measure_temperature', roomTemp);
    if (isOn === false) {
      await this.setCapabilityValue('target_temperature', null);
    } else {
      await this.updateCapability('target_temperature', targetTemp);
    }
    await this.updateCapability('fumes_flow', client.getSpeedFanSmoke());
    await this.updateCapability('smoke_temperature', smokeTemp);
    await this.updateCapability('power_level', powerLevel);
    await this.updateCapability('fan_speed', client.getSpeedFan1());
    await this.updateCapability('firmware_version', sanitizeText(client._getFirmwareVersion()));
    await this.updateCapability('wifi_signal', wifiSignal);
    await this.updateCapability('stove_state', stoveState);

    // Trigger errors are logged and must not stop the remaining triggers
    const fire = (name: string, trigger: () => Promise<void>) => trigger()
      .catch((error) => this.error(`Error triggering ${name} flow:`, error));

    if (stoveState !== null && this.prevStoveState !== stoveState) {
      await fire('stove state changed', () => this.hottohDriver.triggerStoveStateChanged(this, {
        state_id: getStateId(stoveState),
        state_string: stoveState,
      }, {}));
      this.prevStoveState = stoveState;
    }

    if (isOn !== null && this.prevIsOn !== null && this.prevIsOn !== isOn) {
      await fire('any stove on', () => (this.homey.app as HottohApp).triggerAnyStoveOn(this, isOn));
    }
    if (isOn !== null) this.prevIsOn = isOn;

    if (isOn && roomTemp !== null && targetTemp !== null) {
      const reached = Math.abs(roomTemp - targetTemp) <= 0.5;
      if (reached && !this.temperatureReachedTriggered) {
        this.temperatureReachedTriggered = true;
        await fire('temperature reached', () => this.hottohDriver.triggerTemperatureReached(this, {
          temperature: roomTemp,
          target_temperature: targetTemp,
        }, {}));
        await this.turnOffIfArmed();
      } else if (!reached) {
        this.temperatureReachedTriggered = false;
      }
    }

    if (smokeTemp !== null) {
      if (this.prevSmokeTemperature !== null && smokeTemp !== this.prevSmokeTemperature) {
        const previous = this.prevSmokeTemperature;
        await fire('smoke temperature threshold', () => this.hottohDriver.triggerSmokeTemperatureThreshold(this, {
          temperature: smokeTemp,
        }, { previous, current: smokeTemp }));
      }
      this.prevSmokeTemperature = smokeTemp;
    }

    if (wifiSignal !== null) {
      if (this.prevWifiSignal !== null && Math.abs(wifiSignal - this.prevWifiSignal) >= 10) {
        let signalString = 'Poor';
        if (wifiSignal >= -50) {
          signalString = 'Excellent';
        } else if (wifiSignal >= -60) {
          signalString = 'Good';
        } else if (wifiSignal >= -70) {
          signalString = 'Fair';
        }

        await fire('WiFi signal changed', () => this.hottohDriver.triggerWifiSignalChanged(this, {
          signal_value: wifiSignal,
          signal_string: signalString,
        }, {}));
        this.prevWifiSignal = wifiSignal;
      } else if (this.prevWifiSignal === null) {
        this.prevWifiSignal = wifiSignal;
      }
    }

    if (powerLevel !== null && this.prevPowerLevel !== powerLevel) {
      await fire('power level changed', () => this.hottohDriver.triggerPowerLevelChanged(this, {
        power_level: powerLevel,
      }, {}));
      this.prevPowerLevel = powerLevel;
    }
  }

  /**
   * Arm a one-shot turn-off for the next time the room reaches the target temperature.
   * Called by the "turn off when temperature reached" flow action; persisted across restarts.
   */
  async armTurnOffWhenTemperatureReached() {
    await this.setStoreValue(TURN_OFF_WHEN_REACHED_KEY, true);
    this.log('Armed turn-off when target temperature is reached');
  }

  private async turnOffIfArmed() {
    if (!this.getStoreValue(TURN_OFF_WHEN_REACHED_KEY)) return;
    try {
      this.log('Target temperature reached, turning stove off as requested by flow');
      await this.onCapabilityOnOff(false);
      await this.setStoreValue(TURN_OFF_WHEN_REACHED_KEY, false);
    } catch (error) {
      // Stays armed so the next time the temperature is reached it is retried
      this.error('Failed to turn off stove after reaching target temperature:', error);
    }
  }

  private requireClient(): Hottoh {
    if (!this.stoveClient) {
      throw new Error('Stove is not connected');
    }
    return this.stoveClient;
  }

  /**
   * Throw unless a command was queued; the client refuses commands while disconnected
   */
  private assertSent(sent: boolean) {
    if (!sent) {
      throw new Error('Stove is not connected; the command was not sent');
    }
  }

  /**
   * onCapabilityOnOff is called when the user toggles the device on/off
   */
  async onCapabilityOnOff(value: boolean) {
    this.log(`Setting power state to: ${value}`);
    const client = this.requireClient();
    this.assertSent(value ? client.setOn() : client.setOff());
    this.log('Power state command sent successfully');
  }

  /**
   * onCapabilityTargetTemperature is called when the user sets a target temperature
   */
  async onCapabilityTargetTemperature(value: number) {
    this.log(`Setting target temperature to: ${value}`);
    const client = this.requireClient();

    const min = client.getSetMinTemperatureRoom1() ?? 5;
    const max = client.getSetMaxTemperatureRoom1() ?? 35;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(`Target temperature must be between ${min} and ${max} °C, got ${value}`);
    }

    this.assertSent(await client.setTemperature(value));
    this.log('Target temperature command sent successfully');
  }

  /**
   * onCapabilityPowerLevel is called when the user sets a power level
   */
  async onCapabilityPowerLevel(value: number) {
    this.log(`Setting power level to: ${value}`);
    const client = this.requireClient();

    const min = client.getSetMinPowerLevel() ?? 1;
    const max = client.getSetMaxPowerLevel() ?? 5;
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`Power level must be a whole number between ${min} and ${max}, got ${value}`);
    }

    this.assertSent(client.setPowerLevel(value));
    this.log('Power level command sent successfully');
  }

  /**
   * onCapabilityFanSpeed is called when the user sets the fan speed
   */
  async onCapabilityFanSpeed(value: number) {
    this.log(`Setting fan speed to: ${value}`);
    const client = this.requireClient();

    // 1-4 are manual speeds, 5 is auto mode
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new Error(`Fan speed must be a whole number between 1 and 5, got ${value}`);
    }

    this.assertSent(client.setSpeedFan1(value));
    this.log('Fan speed command sent successfully');
  }

  /**
   * This method is called when the user has renamed the device
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log(`Device renamed to: ${name}`);

    // Store the custom name in settings only if it doesn't match our default naming pattern
    const settings = this.getSettings();
    const ip = settings.ipAddress || this.getStoreValue('address');
    const defaultName = `HottoH Stove (${ip})`;

    if (name !== defaultName) {
      // This is a custom name, store it in settings
      await this.setSettings({
        deviceName: name,
      });
      this.log('Custom name saved to device settings');
    } else if (settings.deviceName) {
      // User renamed back to default, clear the stored custom name
      await this.setSettings({
        deviceName: '',
      });
      this.log('Custom name cleared from device settings');
    }
  }

  /**
   * onUninit is called when the app is stopped or restarted.
   */
  async onUninit() {
    this.stopPolling();
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('HottoH device has been deleted');
    this.stopPolling();
  }
};
