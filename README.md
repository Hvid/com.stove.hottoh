# HottoH Stove for Homey

Control your HottoH pellet stove directly from Homey with this app. Monitor temperatures, adjust settings, and create smart heating automations for your home.

## Key Features

- **Control**: Turn your stove on and off, set target temperature, and adjust power levels remotely
- **Monitor**: Track room temperature, smoke temperature, fumes flow, and other important parameters
- **Discover**: Automatic device discovery on your local network
- **Automate**: Extensive flow support for creating advanced heating automations
- **Visualize**: Dashboard widgets for real-time monitoring and control

## Installation

1. Install the app from the Homey App Store
2. Go to "Devices" → "Add device" → "HottoH Stove"
3. Follow the guided pairing process:
   - For automatic discovery, ensure your stove is powered on and connected to your WiFi network
   - If automatic discovery doesn't work, you can manually enter your stove's IP address

## Device Settings

After adding your stove, you can customize it in the device settings:

### IP Address
The IP address of your HottoH stove. This is set during pairing but can be updated if your stove's IP changes.

### Device Name
You can customize the name of your stove. If left empty, the default name format will be used: "HottoH Stove (IP address)".

## Dashboard Widgets

This app includes several widgets for your Homey dashboard:

### Stove Control Widget
The main widget provides controls for power, temperature, and basic monitoring. Features include:
- Power on/off button
- Current and target temperature display
- Power level control
- Operating state indicator

### Temperature Monitoring Widget
Dedicated widget for monitoring all temperature-related metrics:
- Room temperature (current and target)
- Smoke temperature
- Temperature trends

### Stove Status Widget
Compact widget showing the operational state of your stove and key metrics.

## Flow Support

### Triggers

- **Stove State Changed**: Triggers when the stove changes state (e.g., from "Off" to "Running")
- **Room Temperature Reached Target**: Triggers when the room temperature reaches the target temperature
- **Smoke Temperature Threshold**: Triggers when the smoke temperature rises above or falls below a set threshold
- **WiFi Signal Changed**: Triggers when the WiFi signal strength changes significantly
- **Power Level Changed**: Triggers when the power level is changed
- **Any Stove On/Off**: App-level trigger that fires when any stove is turned on or off

### Conditions

- **Stove Is In State**: Checks if the stove is in a specific state
- **Room Temperature Is**: Checks if the room temperature is above/below a certain value
- **Power Level Is**: Checks if the power level is at a specific setting
- **Fan Speed Is**: Checks if the fan speed is at a specific setting
- **WiFi Signal Is**: Checks if the WiFi signal is strong/medium/weak

### Actions

- **Turn Stove On/Off**: Turn the stove on or off
- **Set Target Temperature**: Set the target temperature for the room
- **Set Power Level**: Set the power level of the stove
- **Set Fan Speed**: Set the fan speed
- **Turn Off When Temperature Reached**: Sets the stove to turn off automatically when the target temperature is reached

## Automation Examples

### Energy Saving
- When everyone leaves home, reduce power level and temperature
- When outside temperature drops below freezing, increase power level

### Morning Comfort
- Turn on the stove 30 minutes before your wake-up alarm
- Increase temperature based on weather forecast

### Sleep Mode
- Lower power level and fan speed at bedtime
- Turn off when the room reaches a comfortable sleeping temperature

### Maintenance Alerts
- Get notified when WiFi signal weakens
- Monitor smoke temperature for unusual patterns

## Supported Models

This app should work with all HottoH stoves that have a WiFi module.

## Troubleshooting

### Connection Issues
- Ensure your stove is powered on and connected to your WiFi network
- Check that your Homey is on the same network as your stove
- Try assigning a static IP to your stove in your router settings

### Control Issues
- If commands aren't being received, try restarting your stove
- Ensure your WiFi signal strength to the stove is adequate

## Support

If you encounter any issues with this app, please report them on the [GitHub repository](https://github.com/mikkelhvid/com.stove.hottoh/issues).

## Privacy Policy

This app does not collect or transmit any personal data. All communication is local between your Homey and your HottoH stove.

## Credits

This app uses the [hottohts](https://www.npmjs.com/package/hottohts) library, which is a TypeScript port of the [Hottohpy](https://github.com/benlbrm/hottohpy) Python library.

## License

This app is licensed under the MIT License.
