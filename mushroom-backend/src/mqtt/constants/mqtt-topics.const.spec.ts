import {
  getTuningDesiredTopic,
  getTuningReportedTopic,
  getTuningReportedPattern,
  validateSegment,
  TUNING_REPORTED_GLOBAL_PATTERN,
} from './mqtt-topics.const';

describe('MQTT Topics Constants', () => {
  describe('validateSegment', () => {
    it('should allow valid segments', () => {
      expect(() => validateSegment('tenant1')).not.toThrow();
      expect(() => validateSegment('device_123')).not.toThrow();
      expect(() => validateSegment('device-abc')).not.toThrow();
    });

    it('should throw error for empty or non-string values', () => {
      expect(() => validateSegment('')).toThrow('Topic segment must be a non-empty string');
      expect(() => validateSegment(null as any)).toThrow('Topic segment must be a non-empty string');
      expect(() => validateSegment(undefined as any)).toThrow('Topic segment must be a non-empty string');
    });

    it('should throw error for segments exceeding 50 characters', () => {
      const longSegment = 'a'.repeat(51);
      expect(() => validateSegment(longSegment)).toThrow('Invalid topic segment');
    });

    it('should throw error for topic injection attempts', () => {
      expect(() => validateSegment('tenant/sub')).toThrow('Invalid topic segment');
      expect(() => validateSegment('tenant+')).toThrow('Invalid topic segment');
      expect(() => validateSegment('tenant#')).toThrow('Invalid topic segment');
      expect(() => validateSegment('../device')).toThrow('Invalid topic segment');
    });
  });

  describe('getTuningDesiredTopic', () => {
    it('should build desired topic correctly', () => {
      const topic = getTuningDesiredTopic('mushroom', 'device1');
      expect(topic).toBe('mushroom/esp32/device1/down/tuning/desired');
    });

    it('should throw error if tenant is invalid', () => {
      expect(() => getTuningDesiredTopic('mush/room', 'device1')).toThrow();
    });

    it('should throw error if deviceId is invalid', () => {
      expect(() => getTuningDesiredTopic('mushroom', 'dev+ice1')).toThrow();
    });
  });

  describe('getTuningReportedTopic', () => {
    it('should build reported topic correctly', () => {
      const topic = getTuningReportedTopic('mushroom', 'device1');
      expect(topic).toBe('mushroom/esp32/device1/up/tuning/reported');
    });
  });

  describe('getTuningReportedPattern', () => {
    it('should build subscription pattern correctly', () => {
      const pattern = getTuningReportedPattern('mushroom');
      expect(pattern).toBe('mushroom/esp32/+/up/tuning/reported');
    });
  });

  describe('TUNING_REPORTED_GLOBAL_PATTERN', () => {
    it('should match the global pattern', () => {
      expect(TUNING_REPORTED_GLOBAL_PATTERN).toBe('+/esp32/+/up/tuning/reported');
    });
  });
});
