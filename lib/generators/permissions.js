// Permission mapping and requirements calculation for Monkey C.

const PERMISSION_MAP = {
  restingHeartRate: 'UserProfile',
  steps:            'UserProfile',
  stepGoal:         'UserProfile',
  calories:         'UserProfile',
  activeCalories:   'UserProfile',
  intensityMins:    'UserProfile',
  floorsClimbed:    'UserProfile',
  distance:         'UserProfile',
  hrGraph:          'SensorHistory',
  spo2:             'SensorHistory',
  respirationRate:  'SensorHistory',
  hrvStatus:        'SensorHistory',
  bodyBattery:      'SensorHistory',
  stressLevel:      'SensorHistory',
  vo2Max:           'UserProfile',
  fitnessAge:       'UserProfile',
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
