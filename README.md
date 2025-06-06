# Homey Edilkamin Stove App

This app integrates Edilkamin stoves with Homey using a HottoH adapter. It is production-ready, fully TypeScript, and Homey SDK v3 compliant.

## Features
- LAN-based control and monitoring of Edilkamin stoves
- Capabilities: on/off, target temperature, fan speed, smoke temperature, fumes, power level
- Modern, i18n-ready pairing flow (English & Danish)
- Flow cards: state changed, is on, turn on/off, set target temperature
- Robust logging and error handling

## Installation
1. Clone this repo
2. Run `npm install`
3. Run `homey app run` to test locally

## Pairing
- Add a new device in Homey
- Enter the stove's IP, port, and a custom name
- The app will validate the connection before adding

## Flows
- **Trigger:** Stove state changed
- **Condition:** Stove is on
- **Actions:** Turn on, turn off, set target temperature

## Development
- All backend logs appear in Homey CLI stdout
- All frontend logs appear in the browser console (for App UI)
- Code is modular, robust, and production-ready

## Localization
- English and Danish supported (add more in `locales/`)

## Support
See the official Homey SDK v3 docs:
- https://apps.developer.homey.app/
- https://apps-sdk-v3.developer.homey.app/

---

© 2025, released under MIT License.
