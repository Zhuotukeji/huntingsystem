(function registerScanUtils(target) {
  function fingerprintDifference(left, right) {
    if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY;
    let total = 0;
    for (let index = 0; index < left.length; index += 1) total += Math.abs(left[index] - right[index]);
    return total / left.length;
  }

  function selectKeyframes(frames, maximum = 10) {
    if (!Number.isInteger(maximum) || maximum < 1) throw new Error("maximum must be a positive integer");
    if (frames.length <= maximum) return [...frames];
    if (maximum === 1) return [frames[0]];
    return Array.from({ length: maximum }, (_, index) => frames[Math.round((index * (frames.length - 1)) / (maximum - 1))]);
  }

  target.HuntingScanUtils = { fingerprintDifference, selectKeyframes };
})(globalThis);
