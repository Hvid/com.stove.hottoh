import Homey from 'homey';
import { HottohStove } from '../../lib/HottohStove';

module.exports = class StoveDevice extends Homey.Device {
  private stove: HottohStove | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private prevPowerLevel?: number;
  private prevFanSpeed?: number;
  private prevStoveState?: string;
  private prevIsOn?: boolean;
  private prevRoomTemp?: number;
  private prevTargetTempReached?: boolean;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    const host = this.getStoreValue('host') || this.getSetting('host');
    const port = Number(this.getStoreValue('port') || this.getSetting('port'));
    if (!host || !port) {
      this.setUnavailable('Missing IP address or port');
      return;
    }
    this.stove = new HottohStove(host, port);
    try {
      await this.stove.connect();
      this.startPolling();
      this.setAvailable();
      this.log('Connected to stove at', host, port);
    } catch (err) {
      this.setUnavailable('Failed to connect to stove');
      this.error('Failed to connect to stove:', err);
    }
    this.registerCapabilityListeners();
    this.registerFlowActions();
    this.registerFlowConditions();
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    const host = this.getStoreValue('host');
    const port = this.getStoreValue('port');
    if (host && (!this.getSetting('host') || this.getSetting('host') === '')) {
      this.setSettings({ host });
    }
    if (port && (!this.getSetting('port') || this.getSetting('port') === 0)) {
      this.setSettings({ port });
    }
    this.log('Device added with host:', host, 'port:', port);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    if (this.stove) {
      this.stove.disconnect();
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.log('Device deleted and connection closed');
  }

  registerCapabilityListeners() {
    this.registerCapabilityListener('onoff', async (value) => {
      if (!this.stove) return;
      try {
        if (value) {
          await this.stove.turnOn();
        } else {
          await this.stove.turnOff();
        }
        this.log('Set onoff to', value);
      } catch (err) {
        this.error('Failed to set onoff:', err);
      }
    });
    this.registerCapabilityListener('target_temperature', async (value) => {
      if (!this.stove) return;
      try {
        await this.stove.setTargetTemperature(value);
        this.log('Set target_temperature to', value);
      } catch (err) {
        this.error('Failed to set target_temperature:', err);
      }
    });
    this.registerCapabilityListener('hottoh_fan_speed', async (value) => {
      if (!this.stove) return;
      try {
        await this.stove.setFanSpeed(value);
        this.log('Set hottoh_fan_speed to', value);
      } catch (err) {
        this.error('Failed to set hottoh_fan_speed:', err);
      }
    });
    this.registerCapabilityListener('hottoh_power_level', async (value) => {
      if (!this.stove) return;
      try {
        await this.stove.setPowerLevel(value);
        this.log('Set hottoh_power_level to', value);
      } catch (err) {
        this.error('Failed to set hottoh_power_level:', err);
      }
    });
    // Add more listeners as needed for settable capabilities
  }

  /**
   * Register Homey flow action handlers for this device
   */
  registerFlowActions() {
    // Turn ON stove
    this.homey.flow.getActionCard('turn_on_stove').registerRunListener(async (args, state) => {
      this.log('Flow action: turn_on_stove triggered');
      if (!this.stove) throw new Error('Stove not connected');
      try {
        await this.stove.turnOn();
        this.log('Stove turned ON via flow');
        return true;
      } catch (err) {
        this.error('Failed to turn ON stove via flow:', err);
        throw new Error('Failed to turn ON stove: ' + ((err as Error).message || String(err)));
      }
    });
    // Turn OFF stove
    this.homey.flow.getActionCard('turn_off_stove').registerRunListener(async (args, state) => {
      this.log('Flow action: turn_off_stove triggered');
      if (!this.stove) throw new Error('Stove not connected');
      try {
        await this.stove.turnOff();
        this.log('Stove turned OFF via flow');
        return true;
      } catch (err) {
        this.error('Failed to turn OFF stove via flow:', err);
        throw new Error('Failed to turn OFF stove: ' + ((err as Error).message || String(err)));
      }
    });
    // Set target temperature
    this.homey.flow.getActionCard('set_target_temperature').registerRunListener(async (args, state) => {
      this.log('Flow action: set_target_temperature triggered', args);
      if (!this.stove) throw new Error('Stove not connected');
      if (typeof args.temperature !== 'number') throw new Error('Missing or invalid temperature');
      try {
        await this.stove.setTargetTemperature(args.temperature);
        this.log('Target temperature set via flow:', args.temperature);
        return true;
      } catch (err) {
        this.error('Failed to set target temperature via flow:', err);
        throw new Error('Failed to set target temperature: ' + ((err as Error).message || String(err)));
      }
    });
  }

  /**
   * Register Homey flow condition handlers for this device
   */
  registerFlowConditions() {
    // Is at fan speed
    this.homey.flow.getConditionCard('is_at_fan_speed').registerRunListener(async (args) => {
      if (!this.stove) throw new Error('Stove not connected');
      const current = await this.stove.getFanSpeed();
      return current === args.speed;
    });
    // Is target temperature reached
    this.homey.flow.getConditionCard('is_target_temperature_reached').registerRunListener(async () => {
      if (!this.stove) throw new Error('Stove not connected');
      const current = await this.stove.getRoomTemperature();
      const target = await this.stove.getTargetTemperature();
      return current >= target;
    });
    // Removed: is_in_chrono_mode, is_in_cleaning_mode, is_in_eco_mode
  }

  startPolling() {
    this.pollInterval = setInterval(async () => {
      if (!this.stove) {
        this.setUnavailable('No stove instance');
        return;
      }
      try {
        const isOn = await this.stove.getIsOn();
        const roomTemp = await this.stove.getRoomTemperature();
        const targetTemp = await this.stove.getTargetTemperature();
        const smokeTemp = await this.stove.getSmokeTemperature();
        const fanSpeed = await this.stove.getFanSpeed();
        const fumes = await this.stove.getFumes();
        const powerLevel = await this.stove.getPowerLevel();
        const stoveState = await this.stove.getStoveState();
        // Removed: ecoMode = await this.stove.getEcoMode();
        await this.setCapabilityValue('onoff', isOn);
        if (this.hasCapability('measure_temperature')) await this.setCapabilityValue('measure_temperature', roomTemp);
        if (this.hasCapability('target_temperature')) await this.setCapabilityValue('target_temperature', targetTemp);
        if (this.hasCapability('hottoh_smoke_temperature')) await this.setCapabilityValue('hottoh_smoke_temperature', smokeTemp);
        if (this.hasCapability('hottoh_fan_speed')) await this.setCapabilityValue('hottoh_fan_speed', fanSpeed);
        if (this.hasCapability('hottoh_fumes')) await this.setCapabilityValue('hottoh_fumes', fumes);
        if (this.hasCapability('hottoh_power_level')) await this.setCapabilityValue('hottoh_power_level', powerLevel);
        if (this.hasCapability('hottoh_stove_state')) await this.setCapabilityValue('hottoh_stove_state', stoveState);
        // Removed: if (this.hasCapability('hottoh_eco_mode')) await this.setCapabilityValue('hottoh_eco_mode', ecoMode);
        this.setAvailable();
        this.log('Polling stove for status update');

        // --- FLOW TRIGGER LOGIC ---
        // Power level changed
        if (this.prevPowerLevel !== undefined && powerLevel !== this.prevPowerLevel) {
          this.homey.flow.getTriggerCard('power_level_changed').trigger({ level: powerLevel }, this);
          this.log('Flow trigger: power_level_changed', powerLevel);
        }
        this.prevPowerLevel = powerLevel;

        // Fan speed changed
        if (this.prevFanSpeed !== undefined && fanSpeed !== this.prevFanSpeed) {
          this.homey.flow.getTriggerCard('fan_speed_changed').trigger({ speed: fanSpeed }, this);
          this.log('Flow trigger: fan_speed_changed', fanSpeed);
        }
        this.prevFanSpeed = fanSpeed;

        // Stove state (mode) changed
        if (this.prevStoveState !== undefined && stoveState !== this.prevStoveState) {
          this.homey.flow.getTriggerCard('mode_changed').trigger({ mode: stoveState }, this);
          this.log('Flow trigger: mode_changed', stoveState);
        }
        this.prevStoveState = stoveState;

        // Temperature changed
        if (this.prevRoomTemp !== undefined && roomTemp !== this.prevRoomTemp) {
          this.homey.flow.getTriggerCard('temperature_changed').trigger({ temperature: roomTemp }, this);
          this.log('Flow trigger: temperature_changed', roomTemp);
        }
        this.prevRoomTemp = roomTemp;

        // On/off triggers
        if (this.prevIsOn !== undefined && isOn !== this.prevIsOn) {
          if (isOn) {
            this.homey.flow.getTriggerCard('stove_turned_on').trigger({}, this);
            this.log('Flow trigger: stove_turned_on');
          } else {
            this.homey.flow.getTriggerCard('stove_turned_off').trigger({}, this);
            this.log('Flow trigger: stove_turned_off');
          }
        }
        this.prevIsOn = isOn;

        // Target temperature reached
        const targetReached = roomTemp >= targetTemp;
        if (this.prevTargetTempReached !== undefined && targetReached && !this.prevTargetTempReached) {
          this.homey.flow.getTriggerCard('target_temperature_reached').trigger({ temperature: roomTemp }, this);
          this.log('Flow trigger: target_temperature_reached', roomTemp);
        }
        this.prevTargetTempReached = targetReached;
        // --- END FLOW TRIGGER LOGIC ---
      } catch (err) {
        this.setUnavailable('Polling error');
        this.error('Polling error:', err);
      }
    }, 10000);
  }
};
// All logs from this file will appear in the Homey CLI stdout when running `homey app run`.
