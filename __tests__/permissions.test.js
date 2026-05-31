const { getRequiredPermissions, PERMISSION_MAP } = require('../lib/generators/permissions');

describe('Permissions', () => {
  describe('getRequiredPermissions', () => {
    it('returns empty array for elements with no permissions', () => {
      const elements = [
        { fieldId: 'hours' },
        { fieldId: 'minutes' },
        { fieldId: 'amPm' },
      ];
      const perms = getRequiredPermissions(elements);
      expect(perms).toEqual([]);
    });

    it('returns no permission for fitness counter fields (ActivityMonitor needs no manifest permission)', () => {
      const elements = [
        { fieldId: 'steps' },
        { fieldId: 'calories' },
      ];
      const perms = getRequiredPermissions(elements);
      expect(perms).not.toContain('ActivityMonitor');
      expect(perms).not.toContain('UserProfile');
      expect(perms.length).toBe(0);
    });

    it('returns SensorHistory for sensor fields', () => {
      const elements = [
        { fieldId: 'bodyBattery' },
        { fieldId: 'stressLevel' },
      ];
      const perms = getRequiredPermissions(elements);
      expect(perms).toContain('SensorHistory');
      expect(perms.length).toBe(1);
    });

    it('returns Positioning for location fields', () => {
      const elements = [
        { fieldId: 'sunrise' },
        { fieldId: 'sunset' },
      ];
      const perms = getRequiredPermissions(elements);
      expect(perms).toContain('Positioning');
      expect(perms.length).toBe(1);
    });

    it('combines multiple permission types', () => {
      const elements = [
        { fieldId: 'steps' },        // no permission needed
        { fieldId: 'bodyBattery' },  // SensorHistory
        { fieldId: 'sunrise' },      // Positioning
      ];
      const perms = getRequiredPermissions(elements);
      expect(perms).not.toContain('ActivityMonitor');
      expect(perms).toContain('SensorHistory');
      expect(perms).toContain('Positioning');
      expect(perms.length).toBe(2);
    });

    it('deduplicates permissions', () => {
      const elements = [
        { fieldId: 'bodyBattery' },
        { fieldId: 'stressLevel' },
        { fieldId: 'spo2' },
      ];
      const perms = getRequiredPermissions(elements);
      expect(perms).toEqual(['SensorHistory']);
    });

    it('returns sorted permissions', () => {
      const elements = [
        { fieldId: 'sunrise' },
        { fieldId: 'steps' },
        { fieldId: 'bodyBattery' },
      ];
      const perms = getRequiredPermissions(elements);
      expect(perms).toEqual(
        [...new Set(perms)].sort()
      );
    });

    it('handles empty elements array', () => {
      expect(getRequiredPermissions([])).toEqual([]);
    });

    it('ignores unknown field IDs and fields with no required permission', () => {
      const elements = [
        { fieldId: 'unknownField' },
        { fieldId: 'steps' },          // no manifest permission needed
        { fieldId: 'bodyBattery' },    // SensorHistory
      ];
      const perms = getRequiredPermissions(elements);
      expect(perms).toEqual(['SensorHistory']);
    });
  });

  describe('PERMISSION_MAP', () => {
    it('contains expected permissions', () => {
      // ActivityMonitor.getInfo() and Activity.getActivityInfo() need no manifest permission
      expect(PERMISSION_MAP.steps).toBeUndefined();
      expect(PERMISSION_MAP.heartRate).toBeUndefined();
      expect(PERMISSION_MAP.heartRateZone).toBeUndefined();
      // SensorHistory and Positioning still required
      expect(PERMISSION_MAP.bodyBattery).toBe('SensorHistory');
      expect(PERMISSION_MAP.sunrise).toBe('Positioning');
      // UserProfile still required for profile data
      expect(PERMISSION_MAP.restingHeartRate).toBe('UserProfile');
    });

    it('fields requiring no permission are absent from the map', () => {
      const noPermRequired = ['steps', 'stepGoal', 'calories', 'floorsClimbed', 'distance', 'heartRate', 'heartRateZone'];
      noPermRequired.forEach(field => {
        expect(PERMISSION_MAP[field]).toBeUndefined();
      });
    });

    it('fields with required permissions are present in the map', () => {
      expect(PERMISSION_MAP.bodyBattery).toBe('SensorHistory');
      expect(PERMISSION_MAP.sunrise).toBe('Positioning');
      expect(PERMISSION_MAP.weather).toBe('Positioning');
      expect(PERMISSION_MAP.restingHeartRate).toBe('UserProfile');
    });
  });
});
