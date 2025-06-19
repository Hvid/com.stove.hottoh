import Homey from 'homey';
import { Hottoh } from 'hottohts';
import { EventEmitter } from 'events';

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

module.exports = class HottohDevice extends Homey.Device {
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 5000; // 5 seconds
  private readonly DEFAULT_PORT = 5001; // Default port for HottoH stoves
  private stoveClient: Hottoh | null = null;

  // Store previous values for trigger detection
  private prevStoveState: string | null = null;
  private prevPowerLevel: number | null = null;
  private prevWifiSignal: number | null = null;
  private prevSmokeTemperature: number | null = null;
  private prevRoomTemperature: number | null = null;
  private prevTargetTemperature: number | null = null;
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
    const ipFromSettings = settings.ipAddress;
    const ipFromStore = this.getStoreValue('address');

    // If we have an IP in store but not settings, migrate it
    if (!ipFromSettings && ipFromStore) {
      await this.setSettings({ ipAddress: ipFromStore });
      this.log('Migrated IP address from store to settings:', ipFromStore);
    }

    // Initialize connection test
    const initSuccess = await this.testConnection();

    if (initSuccess) {
      // Get the min/max values for power level and fan speed
      const maxPowerLevel = this.stoveClient?.getSetMaxPowerLevel() ?? 5;
      const minPowerLevel = this.stoveClient?.getSetMinPowerLevel() ?? 1;
      const maxFanSpeed = this.stoveClient?.getSetMaxSpeedFan1() ?? 5;

      // Set capability options
      await this.setCapabilityOptions('power_level', {
        min: minPowerLevel,
        max: maxPowerLevel,
        step: 1
      });

      await this.setCapabilityOptions('fan_speed', {
        min: 1,
        max: maxFanSpeed,
        step: 1
      });

      // Initialize previous values from current capability values
      this.prevStoveState = this.getCapabilityValue('stove_state');
      this.prevPowerLevel = this.getCapabilityValue('power_level');
      this.prevWifiSignal = this.getCapabilityValue('wifi_signal');
      this.prevSmokeTemperature = this.getCapabilityValue('smoke_temperature');
      this.prevRoomTemperature = this.getCapabilityValue('measure_temperature');
      this.prevTargetTemperature = this.getCapabilityValue('target_temperature');

      // Check if the device name should be updated
      this.updateDeviceName();

      // Start polling for updates
      this.startPolling();
    } else {
      this.log('Initial connection test failed, not starting polling');
    }
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
    // IP address changed
    if (changedKeys.includes('ipAddress')) {
      this.log('IP address changed from settings');

      // Stop polling with old client
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }

      // Disconnect old client if it exists
      if (this.stoveClient) {
        try {
          this.stoveClient.disconnect();
        } catch (e) {
          this.error('Error disconnecting old client:', e);
        }
        this.stoveClient = null;
      }

      // Test new connection
      const success = await this.testConnection();
      if (success) {
        // Start polling with new client
        this.startPolling();

        // If no custom name is set, suggest updating the name to include the new IP
        if (!newSettings.deviceName || newSettings.deviceName.trim() === '') {
          this.updateDeviceName();
        }

        return 'Successfully connected to stove at new IP address';
      } else {
        throw new Error('Could not connect to stove at new IP address');
      }
    }
  }

  /**
   * Test connection to the stove
   */
  private async testConnection(): Promise<boolean> {
    try {
      const settings = this.getSettings();
      const ip = settings.ipAddress;

      if (!ip) {
        this.log('No IP address found in device settings. Please set the IP address in device settings.');
        this.setUnavailable('IP address not set. Please configure the device settings.');
        return false;
      }

      this.log(`Testing connection to HottoH stove at ${ip}`);

      // Create a new client for testing
      const testClient = new Hottoh(ip, this.DEFAULT_PORT);

      // Test connection
      await testClient.connect();
      this.log('Connected to HottoH stove');

      // Always disconnect the test client
      try {
        await testClient.disconnect();
      } catch (e) {
        this.error('Error disconnecting test client:', e);
      }

      // Mark device as available
      this.setAvailable();

      return true;
    } catch (error) {
      this.error('Failed to connect to HottoH stove:', error);
      this.setUnavailable('Unable to connect to the stove. Please check if it is powered on and connected to your network.');
      return false;
    }
  }

  /**
   * Helper method to perform an action with a fresh client
   */
  private async withClient<T>(action: (client: Hottoh) => T): Promise<T | null> {
    const settings = this.getSettings();
    const ip = settings.ipAddress;

    if (!ip) {
      this.log('No IP address found in device settings');
      return null;
    }

    let client: Hottoh | null = null;

    try {
      client = new Hottoh(ip, this.DEFAULT_PORT);
      client.connect();

      const result = action(client);
      return result;
    } catch (error) {
      this.error('Error performing action with client:', error);
      return null;
    } finally {
      if (client) {
        try {
          client.disconnect();
        } catch (error) {
          this.error('Error disconnecting client:', error);
        }
      }
    }
  }

  /**
   * Start polling for device updates
   */
  private startPolling() {
    this.stopPolling(); // Stop any existing polling

    // Create a persistent connection
    const settings = this.getSettings();
    const ip = settings.ipAddress;

    if (!ip) {
      this.log('No IP address found in device settings');
      return;
    }

    // Initialize the persistent client
    this.stoveClient = new Hottoh(ip, this.DEFAULT_PORT);
    this.stoveClient.connect();
    this.log('Created persistent connection to stove');

    this.updateInterval = this.homey.setInterval(async () => {
      try {
        await this.updateDeviceState();
        this.setAvailable();
      } catch (error) {
        this.error('Error polling device:', error);
        this.setUnavailable('Connection lost. Trying to reconnect...');

        // Try to reconnect
        try {
          this.stopPolling(); // This will disconnect the client
          const reconnected = await this.testConnection();
          if (reconnected) {
            this.startPolling(); // This will create a new persistent connection
            this.setAvailable();
          }
        } catch (reconnectError) {
          this.error('Failed to reconnect:', reconnectError);
        }
      }
    }, this.POLL_INTERVAL);
  }

  /**
   * Stop the polling interval
   */
  private stopPolling() {
    if (this.updateInterval) {
      this.homey.clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Clean up the persistent connection
    if (this.stoveClient) {
      try {
        this.stoveClient.disconnect();
        this.stoveClient = null;
        this.log('Disconnected persistent stove connection');
      } catch (error) {
        this.error('Error disconnecting persistent client:', error);
      }
    }
  }

  /**
   * Update the device state with latest values from the stove
   * Fetches all relevant data points from the stove and updates capabilities
   */
  private async updateDeviceState() {
    try {
      if (!this.stoveClient) {
        throw new Error('Stove client not initialized');
      }

      // Use the persistent connection to fetch all stove metrics
      const isPoweredOn = this.stoveClient.getIsOn();
      const currentTemp = this.stoveClient.getTemperatureRoom1();
      const targetTemp = this.stoveClient.getSetTemperatureRoom1();
      const fumesFlow = this.stoveClient.getSpeedFanSmoke();
      const smokeTemp = this.stoveClient.getSmokeTemperature();
      const powerLevel = this.stoveClient.getPowerLevel();
      const fanSpeed = this.stoveClient.getSpeedFan1();

      // Get additional diagnostic data
      const firmwareVersion = this.stoveClient._getFirmwareVersion();
      const wifiSignal = this.stoveClient._getWifiSignal();
      const stoveState = this.stoveClient._getStoveState();

      // Store current values for processing triggers
      const roomTemp = currentTemp !== null ? currentTemp : 0;
      const targetTemperature = targetTemp !== null ? targetTemp : 20;
      const smokeTempValue = smokeTemp !== null ? smokeTemp : 0;
      const powerLevelValue = powerLevel !== null ? powerLevel : 1;
      const wifiSignalValue = wifiSignal !== null ? parseInt(wifiSignal) : 0;
      const stoveStateValue = stoveState !== null ? stoveState : 'Unknown';

      // Check if temperature has changed
      const tempChanged = this.prevRoomTemperature !== roomTemp;

      // Update capabilities
      await this.setCapabilityValue('onoff', isPoweredOn !== null ? isPoweredOn : false);
      await this.setCapabilityValue('measure_temperature', roomTemp);
      await this.setCapabilityValue('target_temperature', targetTemperature);
      await this.setCapabilityValue('fumes_flow', fumesFlow !== null ? fumesFlow : 0);
      await this.setCapabilityValue('smoke_temperature', smokeTempValue);
      await this.setCapabilityValue('power_level', powerLevelValue);
      await this.setCapabilityValue('fan_speed', fanSpeed !== null ? fanSpeed : 1);
      await this.setCapabilityValue('firmware_version', firmwareVersion !== null ? firmwareVersion : 'Unknown');
      await this.setCapabilityValue('wifi_signal', wifiSignalValue);
      await this.setCapabilityValue('stove_state', stoveStateValue);

      // Process triggers based on value changes

      // 1. Stove State Changed
      if (this.prevStoveState !== stoveStateValue) {
        await this.hottohDriver.triggerStoveStateChanged(this, {
          state: stoveStateValue
        }, {});
        this.prevStoveState = stoveStateValue;
      }

      // 2. Temperature Reached
      if (Math.abs(roomTemp - targetTemperature) <= 0.5 && !this.temperatureReachedTriggered) {
        await this.hottohDriver.triggerTemperatureReached(this, {
          temperature: roomTemp
        }, {});
        this.temperatureReachedTriggered = true;
      } else if (Math.abs(roomTemp - targetTemperature) > 0.5) {
        // Reset the trigger when temperature is no longer at target
        this.temperatureReachedTriggered = false;
      }

      // 3. Smoke Temperature Threshold (Rising)
      if (this.prevSmokeTemperature !== null && smokeTempValue > this.prevSmokeTemperature) {
        // We need to check for any registered threshold in the flow system
        // This is a simplified approach - normally you'd check against registered thresholds
        await this.hottohDriver.triggerSmokeTemperatureThreshold(this, {
          temperature: smokeTempValue
        }, { rising: true });
      }

      // 4. Smoke Temperature Threshold (Falling)
      if (this.prevSmokeTemperature !== null && smokeTempValue < this.prevSmokeTemperature) {
        // We need to check for any registered threshold in the flow system
        // This is a simplified approach - normally you'd check against registered thresholds
        await this.hottohDriver.triggerSmokeTemperatureThreshold(this, {
          temperature: smokeTempValue
        }, { rising: false });
      }

      // 5. WiFi Signal Changed
      if (this.prevWifiSignal !== null && Math.abs(wifiSignalValue - this.prevWifiSignal) >= 10) {
        await this.hottohDriver.triggerWifiSignalChanged(this, {
          signal: wifiSignalValue
        }, {});
      }

      // 6. Power Level Changed
      if (this.prevPowerLevel !== powerLevelValue) {
        await this.hottohDriver.triggerPowerLevelChanged(this, {
          power_level: powerLevelValue
        }, {});
        this.prevPowerLevel = powerLevelValue;
      }

      // Update previous values for next comparison cycle
      this.prevRoomTemperature = roomTemp;
      this.prevTargetTemperature = targetTemperature;
      this.prevSmokeTemperature = smokeTempValue;
      this.prevWifiSignal = wifiSignalValue;

      // Update device name if temperature has changed and no custom name is set
      if (tempChanged) {
        this.updateDeviceName();
      }
    } catch (error) {
      this.error('Error updating device state:', error);
      throw error; // Re-throw to trigger reconnection logic
    }
  }

  /**
   * onCapabilityOnOff is called when the user toggles the device on/off
   */
  async onCapabilityOnOff(value: boolean) {
    this.log(`Setting power state to: ${value}`);

    try {
      if (!this.stoveClient) {
        throw new Error('Stove client not initialized');
      }

      let result;
      if (value) {
        result = await this.stoveClient.setOn();
      } else {
        result = await this.stoveClient.setOff();
      }

      if (!result) {
        throw new Error(`Failed to ${value ? 'turn on' : 'turn off'} the stove`);
      }

      // Update the capability value
      await this.setCapabilityValue('onoff', value);

      this.log(`Power state set successfully to: ${value}`);
    } catch (error) {
      this.error(`Failed to set power state to ${value}:`, error);
      throw new Error(`Failed to ${value ? 'turn on' : 'turn off'} the stove`);
    }
  }

  /**
   * onCapabilityTargetTemperature is called when the user sets a target temperature
   */
  async onCapabilityTargetTemperature(value: number) {
    this.log(`Setting target temperature to: ${value}`);

    try {
      if (!this.stoveClient) {
        throw new Error('Stove client not initialized');
      }

      const result = await this.stoveClient.setTemperature(value);
      this.log(`Set temperature result: ${result}`);

      if (!result) {
        throw new Error('Failed to set temperature');
      }

      // Update the capability value
      await this.setCapabilityValue('target_temperature', value);

      this.log(`Target temperature set successfully to: ${value}`);
    } catch (error) {
      this.error(`Failed to set target temperature to ${value}:`, error);
      throw new Error(`Failed to set target temperature to ${value}`);
    }
  }

  /**
   * onCapabilityPowerLevel is called when the user sets a power level
   */
  async onCapabilityPowerLevel(value: number) {
    this.log(`Setting power level to: ${value}`);

    try {
      if (!this.stoveClient) {
        throw new Error('Stove client not initialized');
      }

      // Get min/max values
      const maxPowerLevel = this.stoveClient.getSetMaxPowerLevel() ?? 5;
      const minPowerLevel = this.stoveClient.getSetMinPowerLevel() ?? 1;

      // Validate value
      if (value < minPowerLevel || value > maxPowerLevel) {
        throw new Error(`Power level must be between ${minPowerLevel} and ${maxPowerLevel}`);
      }

      const result = this.stoveClient.setPowerLevel(value);
      this.log(`Set power level result: ${result}`);

      if (!result) {
        throw new Error('Failed to set power level');
      }

      // Update the capability value
      await this.setCapabilityValue('power_level', value);

      this.log(`Power level set successfully to: ${value}`);
    } catch (error) {
      this.error(`Failed to set power level to ${value}:`, error);
      throw error;
    }
  }

  /**
   * onCapabilityFanSpeed is called when the user sets the fan speed
   */
  async onCapabilityFanSpeed(value: number) {
    this.log(`Setting fan speed to: ${value}`);

    try {
      if (!this.stoveClient) {
        throw new Error('Stove client not initialized');
      }

      // Get max value (min is always 1)
      const maxFanSpeed = this.stoveClient.getSetMaxSpeedFan1() ?? 5;

      // Validate value
      if (value < 1 || value > maxFanSpeed) {
        throw new Error(`Fan speed must be between 1 and ${maxFanSpeed}`);
      }

      const result = this.stoveClient.setSpeedFan1(value);
      this.log(`Set fan speed result: ${result}`);

      if (!result) {
        throw new Error('Failed to set fan speed');
      }

      // Update the capability value
      await this.setCapabilityValue('fan_speed', value);

      this.log(`Fan speed set successfully to: ${value}`);
    } catch (error) {
      this.error(`Failed to set fan speed to ${value}:`, error);
      throw error;
    }
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
        deviceName: name
      });
      this.log('Custom name saved to device settings');
    } else if (settings.deviceName) {
      // User renamed back to default, clear the stored custom name
      await this.setSettings({
        deviceName: ''
      });
      this.log('Custom name cleared from device settings');
    }
  }

  /**
   * Update device name based on settings and state
   * @private
   */
  private async updateDeviceName() {
    const settings = this.getSettings();

    // If a custom name is set in settings, we don't update the name
    if (settings.deviceName && settings.deviceName.trim() !== '') {
      return;
    }

    // Otherwise use the default naming scheme
    const ip = settings.ipAddress || this.getStoreValue('address');
    const defaultName = `HottoH Stove (${ip})`;

    // We can't set the name programmatically, but we can log that it should be updated
    // The user will need to manually rename the device
    if (this.getName() !== defaultName) {
      this.log(`Device name should be updated to: ${defaultName} (needs manual rename)`);
    }
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('HottoH device has been deleted');
    this.stopPolling();
  }
};
