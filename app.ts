'use strict';

import Homey from 'homey';

module.exports = class HottohApp extends Homey.App {
  private anyStoveOnTrigger: any;

  /**
   * App initialization
   * Sets up flow cards and global listeners
   */
  async onInit() {
    this.log('HottoH Stove App has been initialized');

    // Initialize app-level flows
    this.initAppFlows();

    // Register capability listeners for all devices
    this.registerGlobalCapabilityListeners();
  }

  /**
   * Initialize app-level flow cards
   */
  private initAppFlows() {
    // Setup trigger for any stove on/off state change
    this.anyStoveOnTrigger = this.homey.flow.getTriggerCard('any_stove_on');
    this.anyStoveOnTrigger.registerRunListener(async () => {
      return true; // This trigger always runs when called
    });
  }

  /**
   * Register global capability listeners for all devices
   */
  private registerGlobalCapabilityListeners() {
    try {
      // Check if driver exists before registering listeners
      const driverIds = Object.keys(this.homey.drivers.getDrivers());
      if (driverIds.includes('hottoh')) {
        // Listen for device onoff capability changes globally
        this.homey.drivers.getDriver('hottoh').on('device.capabilities.onoff', async (device: any, value: boolean) => {
          // Trigger the any_stove_on flow
          await this.anyStoveOnTrigger.trigger({
            name: device.getName(),
            state: value
          });
        });
      }
    } catch (error) {
      this.error('Error registering global capability listeners:', error);
    }
  }

  /**
   * Helper method to trigger the any_stove_on flow
   * Called from device.ts when onoff capability changes
   */
  public async triggerAnyStoveOn(device: any, value: boolean) {
    return this.anyStoveOnTrigger.trigger({
      name: device.getName(),
      state: value
    });
  }
}
