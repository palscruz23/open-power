export const PROTECTION_ELIGIBLE_NODE_TYPES = new Set([
  'load',
  'resistive_load',
  'generator',
  'utility',
  'transformer'
]);

export const PROTECTION_DEVICE_TYPE_OPTIONS = [
  { value: 'oc_relay', label: 'Overcurrent Relay' },
  { value: 'recloser', label: 'Recloser' },
  { value: 'fuse', label: 'Fuse' }
];

export const PROTECTION_CURVE_OPTIONS = [
  { value: 'iec_standard_inverse', label: 'IEC Standard Inverse' },
  { value: 'iec_very_inverse', label: 'IEC Very Inverse' },
  { value: 'ansi_moderately_inverse', label: 'ANSI Moderately Inverse' },
  { value: 'ansi_very_inverse', label: 'ANSI Very Inverse' },
  { value: 'ansi_k', label: 'ANSI K Fuse' }
];

const PROTECTION_DEVICE_DEFAULTS = {
  oc_relay: {
    name_suffix: 'Relay',
    curve_family: 'iec_standard_inverse'
  },
  recloser: {
    name_suffix: 'Recloser',
    curve_family: 'ansi_very_inverse'
  },
  fuse: {
    name_suffix: 'Fuse',
    curve_family: 'ansi_k'
  }
};

export function getProtectionDeviceTypeLabel(deviceType) {
  return (
    PROTECTION_DEVICE_TYPE_OPTIONS.find((option) => option.value === deviceType)?.label ||
    'Protection Device'
  );
}

export function buildProtectionDefaults(assetLabel, deviceType = 'oc_relay', existing = {}) {
  const defaults = PROTECTION_DEVICE_DEFAULTS[deviceType] || PROTECTION_DEVICE_DEFAULTS.oc_relay;
  const normalizedLabel =
    typeof assetLabel === 'string' && assetLabel.trim().length > 0 ? assetLabel.trim() : 'Asset';

  return {
    enabled: true,
    phase_mode: 'phase',
    device_type: deviceType,
    curve_family: defaults.curve_family,
    pickup_current_a: '',
    time_dial: '',
    instantaneous_pickup_a: '',
    clearing_time_adder_s: 0,
    name: `${normalizedLabel} ${defaults.name_suffix}`,
    ...existing
  };
}
