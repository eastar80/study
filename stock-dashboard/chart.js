function renderLineChart(series, { up }) {
  const W = 640;
  const H = 220;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 12;

  const values = series.map((p) => p.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const x = (i) => padL + (i / (series.length - 1 || 1)) * innerW;
  const y = (v) => padT + (1 - (v - min) / range) * innerH;

  const linePts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.close).toFixed(1)}`);
  const linePath = `M ${linePts.join(" L ")}`;
  const areaPath = `${linePath} L ${x(series.length - 1).toFixed(1)},${(H - padB).toFixed(
    1
  )} L ${padL.toFixed(1)},${(H - padB).toFixed(1)} Z`;

  const stroke = up ? "#dc2626" : "#2563eb";
  const gradId = up ? "grad-up" : "grad-down";

  return `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="none" role="img" aria-label="주가 추이 차트">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${stroke}" stop-opacity="0.18" />
          <stop offset="100%" stop-color="${stroke}" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#${gradId})" />
      <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </svg>`;
}
