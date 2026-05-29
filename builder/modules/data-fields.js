export const CATEGORIES = [
  { id: 'time',     label: '⏰ Time & Calendar',        open: false },
  { id: 'analog',   label: '⏱ Analog Hands',            open: false },
  { id: 'heart',    label: '❤️ Heart & Cardiovascular', open: false },
  { id: 'energy',   label: '🔋 Energy & Recovery',      open: false },
  { id: 'activity', label: '🚶 Activity & Movement',    open: false },
  { id: 'fitness',  label: '🏋️ Fitness & Training',     open: false },
  { id: 'env',      label: '🌤️ Environment',             open: false },
  { id: 'device',   label: '📱 Smart & Device',          open: false },
  { id: 'custom',   label: '🎨 Custom & Shapes',         open: false },
];

export const DATA_FIELDS = [
  // ── ⏰ Time & Calendar ──────────────────────────────────────────────────────
  { id: 'hours',         label: 'Hours',               icon: '🕐', category: 'time',     apiCall: null, defaultFont: 'FONT_NUMBER_HOT',    defaultColor: '#FFFFFF', preview: '12' },
  { id: 'minutes',       label: 'Minutes',             icon: '⏱',  category: 'time',     apiCall: null, defaultFont: 'FONT_NUMBER_HOT',    defaultColor: '#FFFFFF', preview: '34' },
  { id: 'seconds',       label: 'Seconds',             icon: '⏲',  category: 'time',     apiCall: null, defaultFont: 'FONT_NUMBER_MEDIUM', defaultColor: '#AAAAAA', preview: '56' },
  { id: 'amPm',          label: 'AM/PM',               icon: '🌅', category: 'time',     apiCall: null, defaultFont: 'FONT_SMALL',         defaultColor: '#AAAAAA', preview: 'AM' },
  { id: 'dateFullDate',  label: 'Date with Day',       icon: '🗓',  category: 'time',     apiCall: null, defaultFont: 'FONT_SMALL',         defaultColor: '#CCCCCC', preview: 'Wed, May 27' },
  { id: 'dateMonthDay',  label: 'Date with Month',     icon: '📆', category: 'time',     apiCall: null, defaultFont: 'FONT_SMALL',         defaultColor: '#CCCCCC', preview: 'May 27' },
  { id: 'dateDay',       label: 'Day of Week',         icon: '📅', category: 'time',     apiCall: null, defaultFont: 'FONT_SMALL',         defaultColor: '#CCCCCC', preview: 'WED' },
  { id: 'altTimeZone',   label: 'Alt. Time Zone',      icon: '🌐', category: 'time',     apiCall: null, defaultFont: 'FONT_SMALL',         defaultColor: '#AACCFF', preview: '15:22' },
  { id: 'alarm',         label: 'Next Alarm',          icon: '⏰', category: 'time',     apiCall: null, defaultFont: 'FONT_SMALL',         defaultColor: '#FFCC44', preview: '7:00' },
  { id: 'sunrise',         label: 'Sunrise Time',         icon: '🌅', category: 'time',     apiCall: null, defaultFont: 'FONT_SMALL', defaultColor: '#FFCC44', preview: '6:24 AM' },
  { id: 'sunset',          label: 'Sunset Time',          icon: '🌇', category: 'time',     apiCall: null, defaultFont: 'FONT_SMALL', defaultColor: '#FF8844', preview: '8:47 PM' },
  { id: 'timeTillSunEvent',label: 'Time till Sun Event',  icon: '⏳', category: 'time',     apiCall: null, defaultFont: 'FONT_SMALL', defaultColor: '#FFAA44', preview: '2h 15m' },
  { id: 'moonPhase',     label: 'Moon Phase (Graphic)', icon: '🌙', category: 'time',     apiCall: null, shapeType: 'moonPhase', defaultColor: '#DDDDFF', defaultWidth: 40, defaultHeight: 40, preview: '🌒' },
  { id: 'moonPhasePercent', label: 'Moon Phase %',      icon: '🌙', category: 'time',     apiCall: null, defaultFont: 'FONT_SMALL', defaultColor: '#DDDDFF', preview: '85%' },
  { id: 'calendarEvent', label: 'Next Calendar Event', icon: '📋', category: 'time',     apiCall: null, defaultFont: 'FONT_TINY',          defaultColor: '#AADDFF', preview: 'Meeting 2pm' },

  // ── ⏱ Analog Hands ────────────────────────────────────────────────────────
  // width = hand length (px from pivot), height = tail length behind pivot
  { id: 'analogHour',   label: 'Hour Hand',   icon: '🕛', category: 'analog', shapeType: 'analogHour',   defaultFont: null, defaultColor: '#FFFFFF', defaultWidth: 75,  defaultHeight: 15, preview: '' },
  { id: 'analogMinute', label: 'Minute Hand', icon: '🕐', category: 'analog', shapeType: 'analogMinute', defaultFont: null, defaultColor: '#FFFFFF', defaultWidth: 110, defaultHeight: 20, preview: '' },
  { id: 'analogSecond', label: 'Second Hand', icon: '🕑', category: 'analog', shapeType: 'analogSecond', defaultFont: null, defaultColor: '#FF2222', defaultWidth: 115, defaultHeight: 30, preview: '' },
  { id: 'analogCenter', label: 'Center Cap',  icon: '⚫', category: 'analog', shapeType: 'analogCenter', defaultFont: null, defaultColor: '#FFFFFF', defaultWidth: 7,   defaultHeight: 7,  preview: '' },

  // ── ❤️ Heart & Cardiovascular ───────────────────────────────────────────────
  { id: 'hrGraph',          label: 'Heart Rate Graph',   icon: '📉', category: 'heart', shapeType: 'hrGraph', defaultFont: null, defaultColor: '#FF4444', defaultWidth: 120, defaultHeight: 50, preview: '' },
  { id: 'heartRate',        label: 'Heart Rate',         icon: '❤️', category: 'heart', apiCall: 'Activity.getActivityInfo().currentHeartRate',   defaultFont: 'FONT_MEDIUM', defaultColor: '#FF4444', preview: '72' },
  { id: 'restingHeartRate', label: 'Resting Heart Rate', icon: '💗', category: 'heart', apiCall: 'UserProfile.getProfile().restingHeartRate',      defaultFont: 'FONT_SMALL',  defaultColor: '#FF8888', preview: '58' },
  { id: 'heartRateZone',    label: 'Heart Rate Zone',    icon: '🔴', category: 'heart', apiCall: 'Activity.getActivityInfo().currentHeartRate',   defaultFont: 'FONT_SMALL',  defaultColor: '#FF6600', preview: 'Zone 3' },
  { id: 'spo2',             label: 'SpO2 (Blood Oxygen)',icon: '🫁', category: 'heart', apiCall: null,                                            defaultFont: 'FONT_SMALL',  defaultColor: '#44AAFF', preview: '98%' },
  { id: 'respirationRate',  label: 'Respiration Rate',   icon: '💨', category: 'heart', apiCall: null,                                            defaultFont: 'FONT_SMALL',  defaultColor: '#88CCFF', preview: '14' },
  { id: 'hrvStatus',        label: 'HRV',                icon: '📈', category: 'heart', apiCall: null,                                            defaultFont: 'FONT_SMALL',  defaultColor: '#AAFFAA', preview: '45' },

  // ── 🔋 Energy & Recovery ────────────────────────────────────────────────────
  { id: 'bodyBattery',       label: 'Body Battery™',      icon: '⚡', category: 'energy', apiCall: null, defaultFont: 'FONT_NUMBER_MEDIUM', defaultColor: '#00FF88', preview: '73' },
  { id: 'stressLevel',       label: 'Stress Level',       icon: '🧠', category: 'energy', apiCall: null, defaultFont: 'FONT_SMALL',         defaultColor: '#FF8844', preview: '28' },
  { id: 'recoveryTime',      label: 'Recovery Time',      icon: '🛌', category: 'energy', apiCall: null, defaultFont: 'FONT_SMALL',         defaultColor: '#88AAFF', preview: '14h' },
  { id: 'sleepScore',        label: 'Sleep Score',        icon: '😴', category: 'energy', apiCall: null, defaultFont: 'FONT_MEDIUM',        defaultColor: '#8888FF', preview: '78' },
  { id: 'sleepCoach',        label: 'Sleep Coach',        icon: '🌛', category: 'energy', apiCall: null, defaultFont: 'FONT_SMALL',         defaultColor: '#AAAAFF', preview: '7h 30m' },
  { id: 'trainingReadiness', label: 'Training Readiness', icon: '🎯', category: 'energy', apiCall: null, defaultFont: 'FONT_MEDIUM',        defaultColor: '#44FF88', preview: '82' },

  // ── 🚶 Activity & Movement ──────────────────────────────────────────────────
  { id: 'steps',          label: 'Steps',             icon: '👟', category: 'activity', apiCall: 'Activity.getActivityInfo().steps',             defaultFont: 'FONT_MEDIUM', defaultColor: '#00FF88', preview: '8,432' },
  { id: 'stepGoal',       label: 'Step Goal',         icon: '🎯', category: 'activity', apiCall: 'UserProfile.getProfile().stepsGoal',           defaultFont: 'FONT_SMALL',  defaultColor: '#00CC66', preview: '10000' },
  { id: 'calories',       label: 'Calories (total)',  icon: '🔥', category: 'activity', apiCall: 'Activity.getActivityInfo().calories',          defaultFont: 'FONT_MEDIUM', defaultColor: '#FF8800', preview: '1,842' },
  { id: 'activeCalories', label: 'Active Calories',   icon: '💪', category: 'activity', apiCall: 'Activity.getActivityInfo().calories',          defaultFont: 'FONT_SMALL',  defaultColor: '#FFAA44', preview: '342' },
  { id: 'intensityMins',  label: 'Intensity Minutes', icon: '⚡', category: 'activity', apiCall: 'Activity.getActivityInfo().activeMinutesWeek', defaultFont: 'FONT_SMALL',  defaultColor: '#FF88FF', preview: '45' },
  { id: 'floorsClimbed',  label: 'Floors Climbed',    icon: '🏢', category: 'activity', apiCall: 'Activity.getActivityInfo().floorsClimbed',     defaultFont: 'FONT_SMALL',  defaultColor: '#8888FF', preview: '5' },
  { id: 'distance',       label: 'Distance',          icon: '📍', category: 'activity', apiCall: 'Activity.getActivityInfo().elapsedDistance',   defaultFont: 'FONT_MEDIUM', defaultColor: '#00CCFF', preview: '3.2km' },

  // ── 🏋️ Fitness & Training ───────────────────────────────────────────────────
  { id: 'vo2Max',        label: 'VO₂ Max',              icon: '🫀', category: 'fitness', apiCall: null, defaultFont: 'FONT_MEDIUM', defaultColor: '#FF4488', preview: '48' },
  { id: 'fitnessAge',    label: 'Fitness Age',          icon: '🧬', category: 'fitness', apiCall: null, defaultFont: 'FONT_MEDIUM', defaultColor: '#88FF44', preview: '32' },
  { id: 'acuteLoad',     label: 'Acute Load',           icon: '📊', category: 'fitness', apiCall: null, defaultFont: 'FONT_SMALL',  defaultColor: '#FFAA00', preview: '342' },
  { id: 'lastActivity',  label: 'Last Activity',        icon: '🏅', category: 'fitness', apiCall: null, defaultFont: 'FONT_TINY',   defaultColor: '#CCCCCC', preview: 'Run 5.1km' },
  { id: 'weeklyRunning', label: 'Weekly Running Dist.', icon: '🏃', category: 'fitness', apiCall: null, defaultFont: 'FONT_SMALL',  defaultColor: '#44FFAA', preview: '18.4km' },
  { id: 'weeklyCycling', label: 'Weekly Cycling Dist.', icon: '🚴', category: 'fitness', apiCall: null, defaultFont: 'FONT_SMALL',  defaultColor: '#44AAFF', preview: '55.0km' },

  // ── 🌤️ Environment ──────────────────────────────────────────────────────────
  { id: 'weather',     label: 'Temperature',       icon: '🌡',  category: 'env', apiCall: null, defaultFont: 'FONT_MEDIUM', defaultColor: '#88CCFF', preview: '72°' },
  { id: 'weatherHiLo', label: 'High / Low Temp',  icon: '🌤️', category: 'env', apiCall: null, defaultFont: 'FONT_SMALL',  defaultColor: '#AADDFF', preview: '78° / 61°' },

  // ── 📱 Smart & Device ───────────────────────────────────────────────────────
  { id: 'battery',        label: 'Battery Level',     icon: '🔋',  category: 'device', apiCall: 'Sys.getSystemStats().battery',               defaultFont: 'FONT_SMALL',         defaultColor: '#FFFF00', preview: '85%' },
  { id: 'bluetooth',      label: 'Bluetooth',         icon: '🔵',  category: 'device', apiCall: null, shapeType: 'btIcon', defaultColor: '#0077FF', defaultWidth: 14, defaultHeight: 14, preview: '' },
  { id: 'notifications',  label: 'Notifications',     icon: '🔔',  category: 'device', apiCall: 'Sys.getDeviceSettings().notificationCount',  defaultFont: 'FONT_SMALL',         defaultColor: '#FFFFFF', preview: '3' },
  { id: 'eventCountdown', label: 'Event Countdown',   icon: '⏳',  category: 'device', apiCall: null,                                        defaultFont: 'FONT_SMALL',         defaultColor: '#FFCC44', preview: '3d 4h' },
  { id: 'timer',          label: 'Timer / Stopwatch', icon: '⏱️', category: 'device', apiCall: null,                                        defaultFont: 'FONT_NUMBER_MEDIUM', defaultColor: '#FFFFFF', preview: '00:00' },
  { id: 'utcTime',        label: 'UTC Time',          icon: '🌐',  category: 'device', apiCall: null,                                        defaultFont: 'FONT_SMALL',         defaultColor: '#AACCFF', preview: '19:34' },

  // ── 🎨 Custom & Shapes ──────────────────────────────────────────────────────
  { id: 'customLabel', label: 'Text Label',           icon: '🔤', category: 'custom', apiCall: null, defaultFont: 'FONT_SMALL', defaultColor: '#FFFFFF', preview: 'LABEL' },
  { id: 'shapeCircle', label: 'Circle',              icon: '⭕', category: 'custom', apiCall: null, defaultFont: null, defaultColor: '#FFFFFF', shapeType: 'circle', preview: '' },
  { id: 'shapeLine',   label: 'Line',                icon: '➖', category: 'custom', apiCall: null, defaultFont: null, defaultColor: '#FFFFFF', shapeType: 'line',   preview: '' },
  { id: 'shapeArc',    label: 'Arc',                 icon: '🌙', category: 'custom', apiCall: null, defaultFont: null, defaultColor: '#FFFFFF', shapeType: 'arc',    preview: '' },
  // Tick marks — width = outer radius, height = major tick length
  { id: 'tickHour',   label: 'Hour Tick Ring',       icon: '🕛', category: 'custom', apiCall: null, defaultFont: null, defaultColor: '#FFFFFF', shapeType: 'tickHour',   defaultWidth: 182, defaultHeight: 14, preview: '' },
  { id: 'tickMinute', label: 'Minute Tick Ring',     icon: '⏱',  category: 'custom', apiCall: null, defaultFont: null, defaultColor: '#555555', shapeType: 'tickMinute', defaultWidth: 182, defaultHeight: 5,  preview: '' },
  { id: 'tickMixed',  label: 'Major+Minor Ticks',    icon: '🕐', category: 'custom', apiCall: null, defaultFont: null, defaultColor: '#FFFFFF', shapeType: 'tickMixed',  defaultWidth: 182, defaultHeight: 14, preview: '' },
  { id: 'tickDots',   label: 'Dot Hour Markers',     icon: '•',  category: 'custom', apiCall: null, defaultFont: null, defaultColor: '#FFFFFF', shapeType: 'tickDots',   defaultWidth: 182, defaultHeight: 5,  preview: '' },
];
