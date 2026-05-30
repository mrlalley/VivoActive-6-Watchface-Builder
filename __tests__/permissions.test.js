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

    it('returns ActivityMonitor for fitness counter fields', () => {
      // steps/calories are fetched via ActivityMonitor.getInfo(), not UserProfile
      const elements = [
        { fieldId: 'steps' },
        { fieldId: 'calories' },
      ];
      const perms = getRequiredPermissions(elements);
      expect(perms).toContain('ActivityMonitor');
      expect(perms).not.toContain('UserProfile');
      expect(perms.length).toBe(1);
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
        { fieldId: 'steps' },        // ActivityMonitor
        { fieldId: 'bodyBattery' },  // SensorHistory
        { fieldId: 'sunrise' },      // Positioning
      ];
      const perms = getRequiredPermissions(elements);
      expect(perms).toContain('ActivityMonitor');
      expect(perms).toContain('SensorHistory');
      expect(perms).toContain('Positioning');
      expect(perms.length).toBe(3);
    });

    it('deduplicates permissions', () => {
      const elements = [
        { fieldId: 'steps' },
        { fieldId: 'stepGoal' },
        { fieldId: 'calories' },
      ];
      const perms = getRequiredPermissions(elements);
      expect(perms).toEqual(['ActivityMonitor']);
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

    it('ignores unknown field IDs', () => {
      const elements = [
        { fieldId: 'unknownField' },
        { fieldId: 'steps' },
      ];
      const perms = getRequiredPermissions(elements);
      expect(perms).toEqual(['ActivityMonitor']);
    });
  });

  describe('PERMISSION_MAP', () => {
    it('contains expected permissions', () => {
      // steps fetched via ActivityMonitor.getInfo() — must use ActivityMonitor permission
      expect(PERMISSION_MAP.steps).toBe('ActivityMonitor');
      expect(PERMISSION_MAP.bodyBattery).toBe('SensorHistory');
      expect(PERMISSION_MAP.sunrise).toBe('Positioning');
      // heartRate fetched via UserProfile.getProfile()
      expect(PERMISSION_MAP.heartRate).toBe('UserProfile');
    });

    it('is not missing common fields', () => {
      const commonFields = ['steps', 'bodyBattery', 'sunrise', 'weather'];
      commonFields.forEach(field => {
        expect(PERMISSION_MAP).toHaveProperty(field);
      });
    });
  });
});
