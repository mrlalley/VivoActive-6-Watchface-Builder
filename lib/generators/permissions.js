// Permission mapping for Garmin Connect IQ manifest.xml.
//
// Only permissions that MUST be declared in the manifest are listed here.
// Activity.getActivityInfo() and ActivityMonitor.getInfo() are available
// to all watch faces by default — no manifest permission required.
//
// Valid manifest permission IDs (Connect IQ 4.x):
//   UserProfile, SensorHistory, Positioning, Communications,
//   Sensor, Background, FitContributor

const PERMISSION_MAP = {
  // UserProfile API — fetched via UserProfile.getProfile()
  restingHeartRate: 'UserProfile',
  vo2Max:           'UserProfile',
  fitnessAge:       'UserProfile',
  trainingReadiness:'UserProfile',

  // SensorHistory API — historical sensor data
  hrGraph:          'SensorHistory',
  spo2:             'SensorHistory',
  respirationRate:  'SensorHistory',
  hrvStatus:        'SensorHistory',
  bodyBattery:      'SensorHistory',
  stressLevel:      'SensorHistory',
  recoveryTime:     'SensorHistory',
  sleepScore:       'SensorHistory',
  sleepCoach:       'SensorHistory',
  acuteLoad:        'SensorHistory',

  // Positioning API — location/sun/weather data
  sunrise:          'Positioning',
  sunset:           'Positioning',
  timeTillSunEvent: 'Positioning',
  weather:          'Positioning',
  weatherHiLo:      'Positioning',

  // Fields NOT listed here require no manifest permission:
  //   heartRate, heartRateZone    → Activity.getActivityInfo()
  //   steps, stepGoal, calories,
  //   activeCalories, intensityMins,
  //   floorsClimbed, distance     → ActivityMonitor.getInfo()
  //   All other time/date/device fields → built-in watch face APIs
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
