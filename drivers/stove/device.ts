import Homey from 'homey';
import { HottohStove } from '../../lib/HottohStove';
import { NetworkConstants, StoveRegisters } from '../../lib/constants';

module.exports = class StoveDevice extends Homey.Device {
  private stove: HottohStove | null = null;
  private pollInterval: NodeJS.Timeout | null = null;

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
      this.setAvailable();
      this.log('Connected to stove at', host, port);
      this.startPolling();
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
    if (this.stove) this.stove.disconnect();
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.log('Device deleted and connection closed');
  }

  registerCapabilityListeners() {
    this.registerCapabilityListener('onoff', async (value) => {
      if (!this.stove) return;
      try {
        if (value) {
          await this.stove.turnOn();
          this.log('Set onoff to', value, '(turnOn called)');
        } else {
          await this.stove.turnOff();
          this.log('Set onoff to', value, '(turnOff called)');
        }
        // Immediately poll for updated state and update capability
        await this.stove.fetchStoveStatus();
        const newVal = this.stove.getIsOn();
        await this.setCapabilityValue('onoff', newVal);
        this.log('[CAP onoff] (after set)', newVal);
      } catch (err) {
        this.error('Failed to set onoff:', err);
        throw err;
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
  }

  /**
   * Register Homey flow action handlers for this device
   */
  registerFlowActions() {
    // Turn ON stove
    this.homey.flow.getActionCard('turn_on_stove').registerRunListener(async () => {
      this.log('Flow action: turn_on_stove triggered');
      if (!this.stove) throw new Error('Stove not connected');
      try {
        await this.stove.turnOn();
        this.log('Stove turnOn command sent, waiting 3s for stove to update...');
        await new Promise(res => setTimeout(res, 3000));
        await this.stove.fetchStoveStatus();
        await this.updateAllCapabilities();
        this.log('Stove turned ON via flow (after wait and poll)');
        return true;
      } catch (err) {
        this.error('Failed to turn ON stove via flow:', err);
        throw new Error('Failed to turn ON stove: ' + ((err as Error).message || String(err)));
      }
    });
    // Turn OFF stove
    this.homey.flow.getActionCard('turn_off_stove').registerRunListener(async () => {
      this.log('Flow action: turn_off_stove triggered');
      if (!this.stove) throw new Error('Stove not connected');
      try {
        await this.stove.turnOff();
        this.log('Stove turnOff command sent, waiting 3s for stove to update...');
        await new Promise(res => setTimeout(res, 3000));
        await this.stove.fetchStoveStatus();
        await this.updateAllCapabilities();
        this.log('Stove turned OFF via flow (after wait and poll)');
        return true;
      } catch (err) {
        this.error('Failed to turn OFF stove via flow:', err);
        throw new Error('Failed to turn OFF stove: ' + ((err as Error).message || String(err)));
      }
    });
    // Set target temperature
    this.homey.flow.getActionCard('set_target_temperature').registerRunListener(async (args) => {
      this.log('Flow action: set_target_temperature triggered', args);
      if (!this.stove) throw new Error('Stove not connected');
      if (typeof args.temperature !== 'number') throw new Error('Missing or invalid temperature');
      try {
        await this.stove.setTargetTemperature(args.temperature);
        this.log('Set target_temperature command sent, waiting 3s for stove to update...');
        await new Promise(res => setTimeout(res, 3000));
        await this.stove.fetchStoveStatus();
        await this.updateAllCapabilities();
        this.log('Target temperature set via flow (after wait and poll):', args.temperature);
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
      if (current === undefined || target === undefined) return false;
      return current >= target;
    });

    // Is in alarm state
    this.homey.flow.getConditionCard('is_in_alarm').registerRunListener(async () => {
      if (!this.stove) throw new Error('Stove not connected');
      return this.stove.isInAlarm();
    });
  }

  /**
   * Update all Homey capabilities from the current stove state
   */
  private async updateAllCapabilities() {
    if (!this.stove) return;
    // Log raw data received from the stove
    this.log('[RAW INFO]', this.stove.getRawInfo());
    this.log('[RAW DATR0]', this.stove.getRawDATR0());
    // Update and log capabilities
    if (this.hasCapability('onoff')) {
      const val = this.stove.getIsOn();
      await this.setCapabilityValue('onoff', val);
      this.log('[CAP onoff]', val);
    }
    if (this.hasCapability('measure_temperature')) {
      const val = this.stove.getRoomTemperature();
      await this.setCapabilityValue('measure_temperature', val);
      this.log('[CAP measure_temperature]', val);
    }
    if (this.hasCapability('target_temperature')) {
      const val = this.stove.getTargetTemperature();
      await this.setCapabilityValue('target_temperature', val);
      this.log('[CAP target_temperature]', val);
    }
    if (this.hasCapability('hottoh_fan_speed')) {
      const val = this.stove.getFanSpeed();
      await this.setCapabilityValue('hottoh_fan_speed', val);
      this.log('[CAP hottoh_fan_speed]', val);
    }
    if (this.hasCapability('hottoh_power_level')) {
      const val = this.stove.getPowerLevel();
      await this.setCapabilityValue('hottoh_power_level', val);
      this.log('[CAP hottoh_power_level]', val);
    }
    if (this.hasCapability('hottoh_smoke_temperature')) {
      const val = this.stove.getSmokeTemperature();
      await this.setCapabilityValue('hottoh_smoke_temperature', val);
      this.log('[CAP hottoh_smoke_temperature]', val);
    }
    if (this.hasCapability('hottoh_stove_state')) {
      const val = this.stove.getState();
      await this.setCapabilityValue('hottoh_stove_state', val);
      this.log('[CAP hottoh_stove_state]', val);
    }
    if (this.hasCapability('hottoh_state_description')) {
      // Compose a human-readable description from state only
      const state = this.stove.getState();
      const desc = `State: ${state}`;
      await this.setCapabilityValue('hottoh_state_description', desc);
      this.log('[CAP hottoh_state_description]', desc);
    }
    if (this.hasCapability('hottoh_firmware_version')) {
      const val = this.stove.getFirmwareVersion();
      await this.setCapabilityValue('hottoh_firmware_version', val);
      this.log('[CAP hottoh_firmware_version]', val);
    }
    if (this.hasCapability('hottoh_wifi_signal')) {
      const val = this.stove.getWifiSignal();
      await this.setCapabilityValue('hottoh_wifi_signal', val);
      this.log('[CAP hottoh_wifi_signal]', val);
    }
    if (this.hasCapability('hottoh_manufacturer')) {
      const val = this.stove.getManufacturer();
      await this.setCapabilityValue('hottoh_manufacturer', val);
      this.log('[CAP hottoh_manufacturer]', val);
    }
    if (this.hasCapability('hottoh_stove_state_raw')) {
      // Import StoveRegisters at the top if not already
      const val = String(this.stove['dataDATR0'] ? this.stove['dataDATR0'][StoveRegisters.INDEX_STOVE_STATE] : undefined);
      await this.setCapabilityValue('hottoh_stove_state_raw', val);
      this.log('[CAP hottoh_stove_state_raw]', val);
    }
    if (this.hasCapability('hottoh_fumes')) {
      const val = this.stove.getSmokeTemperature();
      await this.setCapabilityValue('hottoh_fumes', val);
      this.log('[CAP hottoh_fumes]', val);
    }
    if (this.hasCapability('hottoh_last_error_code')) {
      // No substate, so set to undefined or empty string
      const val = '';
      await this.setCapabilityValue('hottoh_last_error_code', val);
      this.log('[CAP hottoh_last_error_code]', val);
    }
    if (this.hasCapability('hottoh_last_update_time')) {
      const val = Date.now();
      await this.setCapabilityValue('hottoh_last_update_time', val);
      this.log('[CAP hottoh_last_update_time]', val);
    }
    this.setAvailable();
    this.log('Stove status updated');
  }

  /**
   * Start polling the stove for updates
   */
  startPolling() {
    this.log('Starting stove status polling');
    const pollInterval = this.getSetting('poll_interval') || NetworkConstants.POLL_INTERVAL_MS;
    this.log(`Polling interval set to ${pollInterval}ms`);
    if (this.pollInterval) this.homey.clearInterval(this.pollInterval);
    this.pollInterval = this.homey.setInterval(async () => {
      try {
        if (!this.stove) {
          this.setUnavailable('Stove not connected');
          return;
        }
        await this.stove.fetchStoveStatus();
        await this.updateAllCapabilities();
      } catch (err) {
        this.setUnavailable('Polling error');
        this.error('Polling error:', err);
      }
    }, pollInterval);
  }
};
// All logs from this file will appear in the Homey CLI stdout when running `homey app run`.
