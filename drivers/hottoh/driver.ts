import Homey from 'homey';
import { discoverStoves } from './discovery';

// Set discovery timeout longer than the base discovery to avoid race conditions
const DISCOVERY_TIMEOUT = 150000; // 2.5 minutes

module.exports = class HottohDriver extends Homey.Driver {
  // Flow trigger cards
  private stoveStateChangedTrigger: any;
  private temperatureReachedTrigger: any;
  private smokeTemperatureThresholdTrigger: any;
  private wifiSignalChangedTrigger: any;
  private powerLevelChangedTrigger: any;

  // Flow condition cards
  private stoveIsInStateCondition: any;
  private roomTemperatureIsCondition: any;
  private powerLevelIsCondition: any;
  private fanSpeedIsCondition: any;
  private wifiSignalIsCondition: any;

  // Flow action cards
  private setPowerStateAction: any;
  private setTargetTemperatureAction: any;
  private setPowerLevelAction: any;
  private setFanSpeedAction: any;
  private turnOffWhenTemperatureReachedAction: any;

  // Store devices that are configured to turn off when temperature is reached
  private turnOffTemperatureReached: Map<string, boolean> = new Map();

  /**
   * Driver initialization
   * Sets up all flow cards for triggers, conditions, and actions
   */
  async onInit() {
    this.log('HottoH Driver has been initialized');

    // Initialize all flow cards
    this.initTriggerCards();
    this.initConditionCards();
    this.initActionCards();
  }

  /**
   * Initialize all trigger flow cards
   */
  private initTriggerCards() {
    // Stove state changed trigger
    this.stoveStateChangedTrigger = this.homey.flow.getDeviceTriggerCard('stove_state_changed');

    // Temperature reached trigger
    this.temperatureReachedTrigger = this.homey.flow.getDeviceTriggerCard('temperature_reached');

    // Smoke temperature threshold trigger
    this.smokeTemperatureThresholdTrigger = this.homey.flow.getDeviceTriggerCard('smoke_temperature_threshold');

    // WiFi signal changed trigger
    this.wifiSignalChangedTrigger = this.homey.flow.getDeviceTriggerCard('wifi_signal_changed');

    // Power level changed trigger
    this.powerLevelChangedTrigger = this.homey.flow.getDeviceTriggerCard('power_level_changed');
  }

  /**
   * Initialize all condition flow cards
   */
  private initConditionCards() {
    // Stove is in state condition
    this.stoveIsInStateCondition = this.homey.flow.getConditionCard('stove_is_in_state');
    this.stoveIsInStateCondition.registerRunListener(async (args: any, state: any) => {
      const device = args.device;
      const currentState = device.getCapabilityValue('stove_state');
      return currentState === args.state;
    });

    // Room temperature is condition
    this.roomTemperatureIsCondition = this.homey.flow.getConditionCard('room_temperature_is');
    this.roomTemperatureIsCondition.registerRunListener(async (args: any, state: any) => {
      const device = args.device;
      const currentTemp = device.getCapabilityValue('measure_temperature');

      switch (args.comparison) {
        case 'above':
          return currentTemp > args.temperature;
        case 'below':
          return currentTemp < args.temperature;
        default:
          return false;
      }
    });

    // Power level is condition
    this.powerLevelIsCondition = this.homey.flow.getConditionCard('power_level_is');
    this.powerLevelIsCondition.registerRunListener(async (args: any, state: any) => {
      const device = args.device;
      const currentLevel = device.getCapabilityValue('power_level');

      switch (args.comparison) {
        case 'above':
          return currentLevel > args.level;
        case 'below':
          return currentLevel < args.level;
        default:
          return false;
      }
    });

    // Fan speed is condition
    this.fanSpeedIsCondition = this.homey.flow.getConditionCard('fan_speed_is');
    this.fanSpeedIsCondition.registerRunListener(async (args: any, state: any) => {
      const device = args.device;
      const currentSpeed = device.getCapabilityValue('fan_speed');

      switch (args.comparison) {
        case 'above':
          return currentSpeed > args.speed;
        case 'below':
          return currentSpeed < args.speed;
        default:
          return false;
      }
    });

    // WiFi signal is condition
    this.wifiSignalIsCondition = this.homey.flow.getConditionCard('wifi_signal_is');
    this.wifiSignalIsCondition.registerRunListener(async (args: any, state: any) => {
      const device = args.device;
      const currentSignal = device.getCapabilityValue('wifi_signal');

      switch (args.comparison) {
        case 'above':
          return currentSignal > args.strength;
        case 'below':
          return currentSignal < args.strength;
        default:
          return false;
      }
    });
  }

  /**
   * Initialize all action flow cards
   */
  private initActionCards() {
    // Set power state action
    this.setPowerStateAction = this.homey.flow.getActionCard('set_power_state');
    this.setPowerStateAction.registerRunListener(async (args: any, state: any) => {
      const device = args.device;
      const value = args.choice === '1'; // Convert to boolean
      await device.onCapabilityOnOff(value);
      return true;
    });

    // Set target temperature action
    this.setTargetTemperatureAction = this.homey.flow.getActionCard('set_target_temperature');
    this.setTargetTemperatureAction.registerRunListener(async (args: any, state: any) => {
      const device = args.device;
      await device.onCapabilityTargetTemperature(args.temperature);
      return true;
    });

    // Set power level action
    this.setPowerLevelAction = this.homey.flow.getActionCard('set_power_level');
    this.setPowerLevelAction.registerRunListener(async (args: any, state: any) => {
      const device = args.device;
      await device.onCapabilityPowerLevel(args.level);
      return true;
    });

    // Set fan speed action
    this.setFanSpeedAction = this.homey.flow.getActionCard('set_fan_speed');
    this.setFanSpeedAction.registerRunListener(async (args: any, state: any) => {
      const device = args.device;
      await device.onCapabilityFanSpeed(args.speed);
      return true;
    });

    // Turn off when temperature reached action
    this.turnOffWhenTemperatureReachedAction = this.homey.flow.getActionCard('turn_off_when_temperature_reached');
    this.turnOffWhenTemperatureReachedAction.registerRunListener(async (args: any, state: any) => {
      const device = args.device;
      const deviceId = device.getData().id;
      // Store if this device should be turned off when temperature is reached
      this.turnOffTemperatureReached.set(deviceId, args.enable === '1');
      this.log(`Set turn off when temperature reached to ${args.enable === '1' ? 'ON' : 'OFF'} for device ${deviceId}`);
      return true;
    });
  }

  /**
   * Trigger the stove state changed flow
   */
  async triggerStoveStateChanged(device: any, tokens: any, state: any) {
    return this.stoveStateChangedTrigger.trigger(device, tokens, state);
  }

  /**
   * Trigger the temperature reached flow
   */
  async triggerTemperatureReached(device: any, tokens: any, state: any) {
    // Also check if this device should be turned off when temperature is reached
    const deviceId = device.getData().id;
    if (this.turnOffTemperatureReached.get(deviceId)) {
      this.log(`Auto-turning off device ${deviceId} because temperature was reached`);
      await device.onCapabilityOnOff(false);
    }
    return this.temperatureReachedTrigger.trigger(device, tokens, state);
  }

  /**
   * Trigger the smoke temperature threshold flow
   */
  async triggerSmokeTemperatureThreshold(device: any, tokens: any, state: any) {
    return this.smokeTemperatureThresholdTrigger.trigger(device, tokens, state);
  }

  /**
   * Trigger the WiFi signal changed flow
   */
  async triggerWifiSignalChanged(device: any, tokens: any, state: any) {
    return this.wifiSignalChangedTrigger.trigger(device, tokens, state);
  }

  /**
   * Trigger the power level changed flow
   */
  async triggerPowerLevelChanged(device: any, tokens: any, state: any) {
    return this.powerLevelChangedTrigger.trigger(device, tokens, state);
  }

  /**
   * onPair is called when a user starts the pairing process.
   */
  async onPair(session: any) {
    // When the 'list_devices' event is fired, return devices
    session.setHandler('list_devices', async () => {
      return await this.onPairListDevices();
    });

    // When the user manually adds a device by IP
    session.setHandler('manual_ip', async (data: any) => {
      const ipAddress = data.ip;

      if (!ipAddress) {
        throw new Error('IP address is required');
      }

      try {
        // Create a device object with the manual IP
        const device = {
          name: `HottoH Stove (${ipAddress})`,
          data: {
            id: `hottoh-${ipAddress}`,
            ipAddress
          },
          settings: {
            ipAddress
          }
        };

        return device;
      } catch (error) {
        this.error('Error during manual IP pairing:', error);
        throw new Error('Could not connect to the stove at that IP address. Please check the IP and try again.');
      }
    });

    // Log when a view is shown (for debugging)
    session.setHandler('showView', async (view: string) => {
      this.log(`Pairing view: ${view}`);
      return true;
    });
  }

  /**
   * This method is called when a user attempts to add a device.
   */
  async onPairListDevices(): Promise<Array<any>> {
    this.log('Searching for HottoH stoves...');

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Discovery timeout')), DISCOVERY_TIMEOUT);
      });

      // Race the discovery against the timeout
      const devices = await Promise.race([
        discoverStoves(),
        timeoutPromise
      ]);

      this.log('Discovery completed');

      if (!Array.isArray(devices)) {
        this.log('Discovery did not return an array');
        return [];
      }

      if (devices.length === 0) {
        this.log('No stoves found during discovery');
      } else {
        this.log('Found stoves:', devices);
      }

      return devices;
    } catch (error: any) {
      // For timeout errors, throw a user-friendly error that will be shown in the GUI
      if (error?.message === 'Discovery timeout') {
        throw new Error(this.homey.__('pair.discovery.timeout_error') || 'Discovery is taking longer than expected. This can happen if there are many devices on your network. Please check that your stove is powered on and connected to WiFi, then try again.');
      }

      // For other errors, log but return empty array
      this.error('Error during device discovery:', error);
      return [];
    }
  }
}
