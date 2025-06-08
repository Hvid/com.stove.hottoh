// Constants and type definitions for Hottoh Stove Homey App
//
// This file defines protocol, register, and state mappings for EdilKamin/Hottoh stoves.
// All mappings are based on the real stove protocol and observed data (see provided Stove Data's).
//
// - Info block: Used for basic device info (firmware, WiFi, manufacturer)
// - DATR0 block: Main data register array, 1:1 mapping to protocol order
// - All indices and scaling factors are derived from real device data
// - State/phase/substate/command mappings are used for Homey capability and flow logic

// Network constants for socket communication with the stove
export const NetworkConstants = {
    DEFAULT_PORT: 5001, // Default TCP port for stove connection
    MAX_RECONNECT_TRIES: 10, // Max reconnection attempts before giving up
    SOCKET_TIMEOUT_MS: 15000, // Socket connection timeout (ms)
    RESPONSE_TIMEOUT_MS: 8000, // Timeout for command responses (ms)
    POLL_INTERVAL_MS: 10000, // How often to poll stove for status (ms)
    COMMAND_DELAY_MS: 1000, // Delay between protocol commands (ms)
} as const;

// Protocol-level constants for message formatting and CRC
export const ProtocolConstants = {
    PROTOCOL_PREFIX: '#', // All protocol messages start with this
    SOCKET_ID: '00', // Default socket ID for protocol
    PROTOCOL_SEPARATOR: ';', // Separator for protocol fields
    PARAM_SEPARATOR: ';', // Separator for command parameters
    PARAM_LENGTH_PAD: 4, // Pad parameter lengths to 4 digits
    CRC_INITIAL: 0xFFFF, // Initial value for CRC16-CCITT-FALSE
    CRC_POLYNOMIAL: 0x1021, // Polynomial for CRC
    CRC_MSB: 0x8000, // Most significant bit for CRC
    CRC_MASK: 0xFFFF, // Mask for CRC result
} as const;

// Protocol command types and modes
export const ProtocolCommands = {
    DEFAULT_COMMAND: 'CMD', // Default command type
    INFO_COMMAND: 'INF',    // Info request command
    DATA_COMMAND: 'DAT',    // Data request command
    DEFAULT_MODE: 'W',      // Default mode (Write)
} as const;

// Command type and mode types for protocol
export type CommandType = 'CMD' | 'INF' | 'DAT';
export type ModeType = 'R' | 'W';

// Register indices for stove protocol
//
// Info block: Used for device info (see Info: ... array in Stove Data's)
// DATR0 block: Main data array, 1:1 mapping to protocol order (see Data: ... array)
// Data2 block: Secondary data array (see Data2: ... array)
//
// All indices must match the real stove protocol order exactly. Do not duplicate indices.
export const StoveRegisters = {
    // Info block (from Info: ... array)
    INDEX_HEADER_INFO: 0,             // Protocol header string (e.g. b'#00000C---0012INFRHOTTOH')
    INDEX_FIRMWARE_VERSION: 1,        // Firmware version (e.g. 6.2.41)
    INDEX_WIFI_SIGNAL: 2,             // WiFi signal strength (dBm, e.g. -62)
    INDEX_MANUFACTURER: 3,            // Manufacturer string (e.g. EdilKamin)

    // DATR0 block (from Data: ... array, header at index 0)
    INDEX_HEADER: 0,                  // Protocol header string (e.g. b'#00000C---0060DATR0')
    INDEX_UNKNOWN_1: 1,               // PROTOCOL_UNKNOWN_VALUE_1 (85)
    INDEX_UNKNOWN_2: 2,               // PROTOCOL_UNKNOWN_VALUE_2 (0)
    INDEX_IS_BITMAP_VISIBLE: 3,       // 1 if bitmap is visible, else 0
    INDEX_IS_VALID: 4,                // 1 if data is valid, else 0
    INDEX_STOVE_TYPE: 5,              // Stove type (e.g. 5)
    INDEX_STOVE_STATE: 6,             // Stove state (see StoveStateMap)
    INDEX_STOVE_IS_ON: 7,             // 1 if stove is on, 0 if off
    INDEX_ECO_MODE: 8,                // 1 if eco mode is enabled, 0 if off
    INDEX_CHRONO_MODE: 9,             // 1 if chrono mode is enabled, 0 if off
    INDEX_TEMPERATURE_ROOM1: 10,      // Room 1 temperature (scaled, see TEMP_SCALE)
    INDEX_SET_TEMPERATURE_ROOM1: 11,  // Setpoint for room 1 temperature (scaled)
    INDEX_SET_MAX_TEMPERATURE_ROOM1: 12, // Max allowed room 1 temperature (scaled)
    INDEX_SET_MIN_TEMPERATURE_ROOM1: 13, // Min allowed room 1 temperature (scaled)
    INDEX_TEMPERATURE_ROOM2: 14,      // Room 2 temperature (scaled, -435 = not present)
    INDEX_SET_TEMPERATURE_ROOM2: 15,  // Setpoint for room 2 temperature (scaled)
    INDEX_SET_MAX_TEMPERATURE_ROOM2: 16, // Max allowed room 2 temperature (scaled)
    INDEX_SET_MIN_TEMPERATURE_ROOM2: 17, // Min allowed room 2 temperature (scaled)
    INDEX_TEMPERATURE_ROOM3: 18,      // Room 3 temperature (scaled, -435 = not present)
    INDEX_SET_TEMPERATURE_ROOM3: 19,  // Setpoint for room 3 temperature (scaled)
    INDEX_SET_MAX_TEMPERATURE_ROOM3: 20, // Max allowed room 3 temperature (scaled)
    INDEX_SET_MIN_TEMPERATURE_ROOM3: 21, // Min allowed room 3 temperature (scaled)
    INDEX_TEMPERATURE_WATER: 22,      // Water temperature (scaled)
    INDEX_SET_TEMPERATURE_WATER: 23,  // Setpoint for water temperature (scaled)
    INDEX_SET_MAX_TEMPERATURE_WATER: 24, // Max allowed water temperature (scaled)
    INDEX_SET_MIN_TEMPERATURE_WATER: 25, // Min allowed water temperature (scaled)
    INDEX_SMOKE_TEMPERATURE: 26,      // Smoke/exhaust temperature (scaled)
    INDEX_POWER_LEVEL: 27,            // Current power level (0-5)
    INDEX_SET_POWER_LEVEL: 28,        // Set power level (0-5)
    INDEX_SET_MAX_POWER_LEVEL: 29,    // Max allowed power level (0-5)
    INDEX_SET_MIN_POWER_LEVEL: 30,    // Min allowed power level (0-5)
    INDEX_SPEED_FAN_SMOKE: 31,        // Smoke fan speed (raw value)
    INDEX_SPEED_FAN1: 32,             // Fan 1 speed (raw value)
    INDEX_SET_SPEED_FAN1: 33,         // Set Fan 1 speed (raw value)
    INDEX_SET_MAX_SPEED_FAN1: 34,     // Max Fan 1 speed (raw value)
    INDEX_SPEED_FAN2: 35,             // Fan 2 speed (raw value)
    INDEX_SET_SPEED_FAN2: 36,         // Set Fan 2 speed (raw value)
    INDEX_SET_MAX_SPEED_FAN2: 37,     // Max Fan 2 speed (raw value)
    INDEX_SPEED_FAN3: 38,             // Fan 3 speed (raw value)
    INDEX_SET_SPEED_FAN3: 39,         // Set Fan 3 speed (raw value)
    INDEX_SET_MAX_SPEED_FAN3: 40,     // Max Fan 3 speed (raw value)
    INDEX_FLOW_SWITCH: 41,            // Flow switch state (1 = on, 0 = off)
    INDEX_GENERIC_PUMP: 42,           // Generic pump state (1 = on, 0 = off)
    INDEX_AIR_EX1: 43,                // Air Exchanger 1
    INDEX_AIR_EX2: 44,                // Air Exchanger 2
    INDEX_AIR_EX3: 45,                // Air Exchanger 3
    // ...add more as needed for all capabilities, always match protocol order...
} as const;

// Data2 block (from Data2: ... array, header at index 0)
export const StoveRegistersData2 = {
    INDEX_HEADER_DATA2: 0,            // Protocol header string (e.g. b'#00000C---003EDATR2')
    INDEX_UNKNOWN_1: 1,               // PROTOCOL_UNKNOWN_VALUE_1 (1)
    INDEX_UNKNOWN_2: 2,               // PROTOCOL_UNKNOWN_VALUE_2 (0)
    INDEX_UNKNOWN_3: 3,               // PROTOCOL_UNKNOWN_VALUE_3 (70)
    INDEX_UNKNOWN_4: 4,               // PROTOCOL_UNKNOWN_VALUE_4 (48)
    INDEX_PUFFER: 5,                  // Puffer temperature (scaled, -435 = not present)
    INDEX_SET_PUFFER: 6,              // Setpoint for puffer temperature (scaled)
    INDEX_SET_MIN_PUFFER: 7,          // Min allowed puffer temperature (scaled)
    INDEX_SET_MAX_PUFFER: 8,          // Max allowed puffer temperature (scaled)
    INDEX_BOILER: 9,                  // Boiler temperature (scaled)
    INDEX_SET_BOILER: 10,             // Setpoint for boiler temperature (scaled)
    INDEX_SET_MIN_BOILER: 11,         // Min allowed boiler temperature (scaled)
    INDEX_SET_MAX_BOILER: 12,         // Max allowed boiler temperature (scaled)
    INDEX_DHW: 13,                    // DHW (Domestic Hot Water) temperature (scaled)
    INDEX_SET_DHW: 14,                // Setpoint for DHW temperature (scaled)
    INDEX_SET_MIN_DHW: 15,            // Min allowed DHW temperature (scaled)
    INDEX_SET_MAX_DHW: 16,            // Max allowed DHW temperature (scaled)
    // ...add more as needed for all capabilities, always match protocol order...
} as const;

// Stove command parameter indices for protocol commands
// These are used for setting values (on/off, power, fan, temperature)
export const StoveCommands = {
    PARAM_ON_OFF: 0,                    // Parameter index for on/off
    PARAM_POWER_LEVEL: 2,               // Parameter index for power level
    PARAM_FAN_SPEED: 5,                 // Parameter index for main fan speed
    PARAM_SET_TEMP: 3,                  // Parameter index for room 1 set temperature
} as const;

// Stove state mappings (numeric value to Homey capability/state string)
// Used for mapping protocol state values to Homey states and flows
export type StoveState =
  | 'switched_off'
  | 'starting_1_pre_ventilation'
  | 'starting_2_loading'
  | 'starting_3_ignition'
  | 'starting_4_flame_check'
  | 'starting_5_stabilization'
  | 'starting_6_modulation'
  | 'starting_7_stabilization'
  | 'on'
  | 'modulation'
  | 'stopping_1_modulation'
  | 'stopping_2_extinction'
  | 'stopping_3_cleaning'
  | 'stopping_4_post_ventilation'
  | 'alarm'
  | 'out_of_fuel'
  | 'unknown';

export const StoveStateMap: Record<number, StoveState> = {
  0: 'switched_off',
  1: 'starting_1_pre_ventilation',
  2: 'starting_2_loading',
  3: 'starting_3_ignition',
  4: 'starting_4_flame_check',
  5: 'starting_5_stabilization',
  6: 'starting_6_modulation',
  7: 'starting_7_stabilization',
  8: 'on',
  9: 'modulation',
  10: 'stopping_1_modulation',
  11: 'stopping_2_extinction',
  12: 'stopping_3_cleaning',
  13: 'stopping_4_post_ventilation',
  14: 'alarm',
  15: 'out_of_fuel',
};

// Alarm state mappings (numeric value to Homey alarm string)
// Used for mapping protocol alarm values to Homey diagnostics and flows
export type AlarmState = 'no_alarm' | 'failed_ignition' | 'low_pressure' | 'overtemp_smoke' | 'overtemp_water' | 'encoder_failure' |
                        'igniter_failure' | 'motor_failure' | 'power_failure' | 'communication_error' | 'safety_thermostat' |
                        'vacuum_switch' | 'smoke_probe_failure' | 'flame_sensor_failure' | 'gearmotor_failure' | 'pellet_level_low' |
                        'door_open' | 'depression_error' | 'maintenance_needed';

export const AlarmStateMap: Record<number, AlarmState> = {
    0: 'no_alarm',
    1: 'failed_ignition',
    2: 'low_pressure',
    3: 'overtemp_smoke',
    4: 'overtemp_water',
    5: 'encoder_failure',
    6: 'igniter_failure',
    7: 'motor_failure',
    8: 'power_failure',
    9: 'communication_error',
    10: 'safety_thermostat',
    11: 'vacuum_switch',
    12: 'smoke_probe_failure',
    13: 'flame_sensor_failure',
    14: 'gearmotor_failure',
    15: 'pellet_level_low',
    16: 'door_open',
    17: 'depression_error',
    18: 'maintenance_needed'
} as const;

// Protocol magic values (for unknown or special protocol values)
export const PROTOCOL_UNKNOWN_VALUE_1 = 85;      // Used at DATR0[1]
export const PROTOCOL_UNKNOWN_VALUE_2 = 0;       // Used at DATR0[2], Data2[2], etc.
export const PROTOCOL_UNKNOWN_VALUE_3 = 70;      // Used at Data2[3]
export const PROTOCOL_UNKNOWN_VALUE_4 = 48;      // Used at Data2[4]
export const PROTOCOL_NOT_PRESENT_VALUE = -435;  // Used for 'not present' fields (e.g. temp sensors)

// Scaling factors for protocol values
// Most temperature values are multiplied by 10 in the protocol (e.g. 257 = 25.7°C)
export const TEMP_SCALE = 10;         // Divide by 10 to get °C from protocol values
