// Permission mapping and requirements calculation for Monkey C.

const PERMISSION_MAP = {
  // Activity API — current activity data
  heartRate:        'Activity',
  heartRateZone:    'Activity',
  steps:            'Activity',
  calories:         'Activity',
  activeCalories:   'Activity',
  intensityMins:    'Activity',
  floorsClimbed:    'Activity',
  distance:         'Activity',

  // UserProfile API — profile settings and goals
  restingHeartRate: 'UserProfile',
  stepGoal:         'UserProfile',
  vo2Max:           'UserProfile',
  fitnessAge:       'UserProfile',

  // SensorHistory API — advanced metrics
  hrGraph:          'SensorHistory',
  spo2:             'SensorHistory',
  respirationRate:  'SensorHistory',
  hrvStatus:        'SensorHistory',
  bodyBattery:      'SensorHistory',
  stressLevel:      'SensorHistory',

  // Positioning API — location data (sunrise, sunset, weather)
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
    if (perm) perms.add(perm);
  });
  return [...perms].sort();
}

module.exports = { PERMISSION_MAP, getRequiredPermissions };
