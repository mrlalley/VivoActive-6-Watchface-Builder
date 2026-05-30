// Permission mapping and requirements calculation for Monkey C.

const PERMISSION_MAP = {
  // Activity API — no explicit permission required for Activity.getActivityInfo()
  heartRate:        null,
  heartRateZone:    null,
  steps:            null,
  calories:         null,
  activeCalories:   null,
  intensityMins:    null,
  floorsClimbed:    null,
  distance:         null,

  // UserProfile API — requires UserProfile permission
  restingHeartRate: 'UserProfile',
  stepGoal:         'UserProfile',
  vo2Max:           'UserProfile',
  fitnessAge:       'UserProfile',

  // SensorHistory API — requires SensorHistory permission
  hrGraph:          'SensorHistory',
  spo2:             'SensorHistory',
  respirationRate:  'SensorHistory',
  hrvStatus:        'SensorHistory',
  bodyBattery:      'SensorHistory',
  stressLevel:      'SensorHistory',

  // Positioning API — requires Positioning permission for location data
  sunrise:          'Positioning',
  sunset:           'Positioning',
  timeTillSunEvent: 'Positioning',
  weather:          'Positioning',
  weatherHiLo:      'Positioning',
};

function getRequiredPermissions(elements) {
  const perms = new Set();
  elements.forEach(el => {
    const perm = PERMISSION_MAP[el.fieldId];
    // Only add non-null permissions (null means no permission required)
    if (perm !== undefined && perm !== null) {
      perms.add(perm);
    }
  });

  return [...perms].sort();
}

module.exports = { PERMISSION_MAP, getRequiredPermissions };
