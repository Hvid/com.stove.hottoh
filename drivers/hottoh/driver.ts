import Homey from 'homey';
import net from 'net';
import { discoverStoves, getDeviceId } from './discovery';
import { getStateCategory } from './stove-state';

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
  private setTargetTemperatureAction: any;
  private setPowerLevelAction: any;
  private setFanSpeedAction: any;
  private turnOffWhenTemperatureReachedAction: any;

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
    // Only fire flows whose threshold was crossed in the chosen direction since the previous poll
    this.smokeTemperatureThresholdTrigger.registerRunListener(async (args: any, state: any) => {
      switch (args.type) {
        case 'above':
          return state.previous <= args.threshold && state.current > args.threshold;
        case 'below':
          return state.previous >= args.threshold && state.current < args.threshold;
        default:
          return false;
      }
    });

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
      const { device } = args;
      return getStateCategory(device.getCapabilityValue('stove_state')) === args.state;
    });

    // Room temperature is condition
    this.roomTemperatureIsCondition = this.homey.flow.getConditionCard('room_temperature_is');
    this.roomTemperatureIsCondition.registerRunListener(async (args: any, state: any) => {
      const { device } = args;
      const currentTemp = device.getCapabilityValue('measure_temperature');

      switch (args.comparison) {
        case 'above':
          return currentTemp > args.temperature;
        case 'below':
          return currentTemp < args.temperature;
        case 'equals':
          return Math.abs(currentTemp - args.temperature) < 0.5; // Allow small tolerance for equality
        default:
          return false;
      }
    }); // Power level is condition
    this.powerLevelIsCondition = this.homey.flow.getConditionCard('power_level_is');
    this.powerLevelIsCondition.registerRunListener(async (args: any, state: any) => {
      const { device } = args;
      const currentLevel = device.getCapabilityValue('power_level');

      switch (args.comparison) {
        case 'above':
          return currentLevel > args.level;
        case 'below':
          return currentLevel < args.level;
        case 'equals':
          return currentLevel === args.level;
        default:
          return false;
      }
    }); // Fan speed is condition
    this.fanSpeedIsCondition = this.homey.flow.getConditionCard('fan_speed_is');
    this.fanSpeedIsCondition.registerRunListener(async (args: any, state: any) => {
      const { device } = args;
      const currentSpeed = device.getCapabilityValue('fan_speed');

      switch (args.comparison) {
        case 'above':
          return currentSpeed > args.speed;
        case 'below':
          return currentSpeed < args.speed;
        case 'equals':
          return currentSpeed === args.speed;
        default:
          return false;
      }
    }); // WiFi signal is condition
    this.wifiSignalIsCondition = this.homey.flow.getConditionCard('wifi_signal_is');
    this.wifiSignalIsCondition.registerRunListener(async (args: any, state: any) => {
      const { device } = args;
      const currentSignal = device.getCapabilityValue('wifi_signal');

      switch (args.comparison) {
        case 'above':
          return currentSignal > args.strength;
        case 'below':
          return currentSignal < args.strength;
        case 'equals':
          return currentSignal === args.strength;
        default:
          return false;
      }
    });
  }

  /**
   * Initialize all action flow cards
   */
  private initActionCards() {
    // Set target temperature action
    this.setTargetTemperatureAction = this.homey.flow.getActionCard('set_target_temperature');
    this.setTargetTemperatureAction.registerRunListener(async (args: any, state: any) => {
      const { device } = args;
      await device.onCapabilityTargetTemperature(args.temperature);
      return true;
    });

    // Set power level action
    this.setPowerLevelAction = this.homey.flow.getActionCard('set_power_level');
    this.setPowerLevelAction.registerRunListener(async (args: any, state: any) => {
      const { device } = args;
      await device.onCapabilityPowerLevel(args.level);
      return true;
    });

    // Set fan speed action
    this.setFanSpeedAction = this.homey.flow.getActionCard('set_fan_speed');
    this.setFanSpeedAction.registerRunListener(async (args: any, state: any) => {
      const { device } = args;
      await device.onCapabilityFanSpeed(args.speed);
      return true;
    });

    // Turn off when temperature reached action
    this.turnOffWhenTemperatureReachedAction = this.homey.flow.getActionCard('turn_off_when_temperature_reached');
    this.turnOffWhenTemperatureReachedAction.registerRunListener(async (args: any, state: any) => {
      await args.device.armTurnOffWhenTemperatureReached();
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
      const ipAddress = String(data?.ipAddress ?? '').trim();

      if (!net.isIPv4(ipAddress)) {
        throw new Error(`"${ipAddress}" is not a valid IPv4 address. Enter an address such as 192.168.1.50.`);
      }

      // Same id format as discovery, so a stove cannot be paired twice
      return {
        name: `HottoH Stove (${ipAddress})`,
        data: {
          id: getDeviceId(ipAddress),
          address: ipAddress,
        },
        settings: {
          ipAddress,
        },
        store: {
          address: ipAddress,
        },
      };
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
      // discoverStoves() bounds its own run time
      const devices = await discoverStoves();

      if (devices.length === 0) {
        this.log('No stoves found during discovery');
      } else {
        this.log('Found stoves:', devices.map((d) => d.data.address));
      }

      return devices;
    } catch (error) {
      this.error('Error during device discovery:', error);
      return [];
    }
  }
};
