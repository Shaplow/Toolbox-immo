const LETTERS = ["A", "B", "C", "D", "E", "F", "G"] as const;
type Letter = typeof LETTERS[number];

const ENERGY_FILL: Record<Letter, string> = {
  A: "#2ea36a",
  B: "#59b956",
  C: "#a7cd69",
  D: "#f6ec22",
  E: "#f4bb23",
  F: "#ee8b39",
  G: "#e0272b",
};

const ENERGY_TEXT: Record<Letter, string> = {
  A: "#fff",
  B: "#fff",
  C: "#fff",
  D: "#fff",
  E: "#fff",
  F: "#fff",
  G: "#fff",
};

const CLIMATE_FILL: Record<Letter, string> = {
  A: "#9fd0f0",
  B: "#85afd7",
  C: "#7a98be",
  D: "#65759d",
  E: "#5a6187",
  F: "#474066",
  G: "#2f2244",
};

const CLIMATE_TEXT: Record<Letter, string> = {
  A: "#fff",
  B: "#fff",
  C: "#fff",
  D: "#fff",
  E: "#fff",
  F: "#fff",
  G: "#fff",
};

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function houseIconWhite(cx: number, cy: number, size: number): string {
  const roofHalf = size * 0.46;
  const roofTopY = cy - size * 0.5;
  const roofBaseY = cy - size * 0.04;
  const bodyHalf = size * 0.34;
  const bodyBottom = cy + size * 0.36;
  const eyeOffset = size * 0.12;
  const eyeY = cy - size * 0.02;
  const mouthY = cy + size * 0.16;
  const iconStroke = Math.max(3.5, size * 0.075);
  const featureStroke = Math.max(2.5, size * 0.055);

  const leftRoofX = cx - roofHalf;
  const rightRoofX = cx + roofHalf;
  const leftBodyX = cx - bodyHalf;
  const rightBodyX = cx + bodyHalf;

  function arrow(x1: number, y1: number, x2: number, y2: number): string {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = size * 0.12;
    const wing = size * 0.06;
    const hx1 = x2 - head * Math.cos(angle) + wing * Math.sin(angle);
    const hy1 = y2 - head * Math.sin(angle) - wing * Math.cos(angle);
    const hx2 = x2 - head * Math.cos(angle) - wing * Math.sin(angle);
    const hy2 = y2 - head * Math.sin(angle) + wing * Math.cos(angle);
    return [
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="white" stroke-width="${iconStroke}" stroke-linecap="round"/>`,
      `<path d="M ${hx1},${hy1} L ${x2},${y2} L ${hx2},${hy2}" stroke="white" stroke-width="${iconStroke}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    ].join("");
  }

  return [
    arrow(cx, roofTopY + size * 0.04, cx, cy - size * 0.8),
    arrow(cx - size * 0.18, roofBaseY + size * 0.03, cx - size * 0.76, cy - size * 0.64),
    arrow(cx + size * 0.18, roofBaseY + size * 0.03, cx + size * 0.76, cy - size * 0.64),
    arrow(leftBodyX + size * 0.04, cy + size * 0.18, cx - size * 0.76, cy + size * 0.48),
    arrow(rightBodyX - size * 0.04, cy + size * 0.18, cx + size * 0.76, cy + size * 0.48),
    arrow(cx, bodyBottom - size * 0.03, cx, cy + size * 0.8),
    `<path d="M ${cx},${roofTopY} L ${leftRoofX},${roofBaseY} L ${leftBodyX},${roofBaseY} L ${leftBodyX},${bodyBottom} L ${rightBodyX},${bodyBottom} L ${rightBodyX},${roofBaseY} L ${rightRoofX},${roofBaseY} Z" fill="white"/>`,
    `<circle cx="${cx - eyeOffset}" cy="${eyeY}" r="${size * 0.034}" fill="${ENERGY_FILL.G}"/>`,
    `<circle cx="${cx + eyeOffset}" cy="${eyeY}" r="${size * 0.034}" fill="${ENERGY_FILL.G}"/>`,
    `<path d="M ${cx - size * 0.15},${mouthY + size * 0.03} Q ${cx},${mouthY - size * 0.11} ${cx + size * 0.15},${mouthY + size * 0.03}" stroke="${ENERGY_FILL.G}" stroke-width="${featureStroke}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join("");
}

function buildFrame(
  viewWidth: number,
  viewHeight: number,
  options: { showFrame: boolean; frameColor: string; showBackground: boolean; backgroundColor: string }
): string {
  const fill = options.showBackground ? options.backgroundColor : "transparent";
  const stroke = options.showFrame ? options.frameColor : "transparent";
  const strokeWidth = options.showFrame ? 6 : 0;
  return `<rect x="11" y="11" width="${viewWidth - 22}" height="${viewHeight - 22}" rx="40" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function drawEnergyBar(letter: Letter, x: number, y: number, width: number, height: number, active: boolean): string {
  const tip = active ? 36 : 24;
  const endX = x + width;
  const midY = y + height / 2;
  const points = `${x},${y} ${endX},${y} ${endX + tip},${midY} ${endX},${y + height} ${x},${y + height}`;
  const fontSize = active ? 84 : 33;
  const textX = x + (active ? 12 : 14);
  return [
    `<polygon points="${points}" fill="${ENERGY_FILL[letter]}"${active ? ` stroke="#151515" stroke-width="3" stroke-linejoin="round"` : ""}/>`,
    `<text x="${textX}" y="${midY}" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="700" fill="${ENERGY_TEXT[letter]}" dominant-baseline="central">${letter}</text>`,
  ].join("");
}

function drawClimateBar(letter: Letter, x: number, y: number, width: number, height: number, active: boolean): string {
  const radius = height / 2;
  const path = `M ${x},${y} L ${x + width - radius},${y} A ${radius},${radius},0,0,1,${x + width - radius},${y + height} L ${x},${y + height} Z`;
  const fontSize = active ? 62 : 33;
  const textX = x + (active ? 15 : 14);
  return [
    `<path d="${path}" fill="${CLIMATE_FILL[letter]}"${active ? ` stroke="#151515" stroke-width="3"` : ""}/>`,
    `<text x="${textX}" y="${y + height / 2}" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="700" fill="${CLIMATE_TEXT[letter]}" dominant-baseline="central">${letter}</text>`,
  ].join("");
}

function buildEnergySvg(
  activeLetter: string,
  kwhValue: string,
  co2Value: string,
  options: { showFrame: boolean; frameColor: string; showBackground: boolean; backgroundColor: string }
): string {
  const activeIndex = LETTERS.indexOf(activeLetter.toUpperCase() as Letter);
  const currentIndex = activeIndex >= 0 ? activeIndex : 2;
  const viewWidth = 760;
  const viewHeight = 760;
  const firstBarY = 182;
  const barX = 270;
  const widths = [76, 108, 144, 186, 228, 270, 362];
  const normalH = 54;
  const activeH = 106;
  const rowGap = 6;
  const boxH = 106;
  const energyBoxW = 98;
  const co2BoxW = 118;
  const boxesX = 46;
  const boxGap = 0;
  const activeTargetWidth = energyBoxW + co2BoxW + 20;
  const rowHeights = LETTERS.map((_, index) => (index === currentIndex ? activeH : normalH));
  const rowYs: number[] = [];
  let cursorY = firstBarY;
  for (let index = 0; index < LETTERS.length; index++) {
    rowYs.push(cursorY);
    cursorY += rowHeights[index] + rowGap;
  }
  const diagramBottom = cursorY - rowGap;
  const boxY = Math.min(Math.max(rowYs[currentIndex], 228), 590 - boxH);
  const valueMidY = boxY + boxH / 2;
  const passoireTop = rowYs[5] + 2;
  const passoireBottom = rowYs[6] + rowHeights[6] - 2;
  const passoireMid = (passoireTop + passoireBottom) / 2;
  const kwhDisplay = kwhValue ? esc(kwhValue) : "-";
  const co2Display = co2Value ? `${esc(co2Value)}*` : "*";

  let bars = "";
  let activeBar = "";
  for (let index = 0; index < LETTERS.length; index++) {
    const letter = LETTERS[index];
    const isActive = index === currentIndex;
    const height = rowHeights[index];
    const y = rowYs[index];
    const width = isActive ? Math.max(widths[index], activeTargetWidth) : widths[index];
    if (isActive) {
      activeBar = drawEnergyBar(letter, barX, y, width, height, true);
    } else {
      bars += drawEnergyBar(letter, barX, y, width, height, false);
    }
    if (isActive && currentIndex >= 5) {
      const iconX = barX + width - 42;
      activeBar += houseIconWhite(iconX, y + height / 2 + 1, 58);
    }
  }

  const passoire = currentIndex >= 5 ? "" : [
    `<text x="252" y="${passoireMid - 16}" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="26" font-weight="700" fill="#8b8b8b">Passoire</text>`,
    `<text x="252" y="${passoireMid + 18}" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="26" font-weight="700" fill="#8b8b8b">énergétique</text>`,
    `<line x1="262" y1="${passoireTop}" x2="262" y2="${passoireBottom}" stroke="#8b8b8b" stroke-width="4" stroke-linecap="round"/>`,
  ].join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${viewHeight}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;">
  ${buildFrame(viewWidth, viewHeight, options)}
  <text x="38" y="72" font-family="Arial,Helvetica,sans-serif" font-size="36" font-weight="700" fill="#111">Performance énergétique</text>
  <text x="270" y="168" font-family="Arial,Helvetica,sans-serif" font-size="26" font-weight="700" fill="#2ea36a">Logement extrêmement performant</text>
  <text x="83" y="${boxY - 27}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="19" font-weight="700" fill="#333">consommation</text>
  <text x="83" y="${boxY - 8}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" fill="#666">(énergie primaire)</text>
  <text x="196" y="${boxY - 13}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="19" font-weight="700" fill="#333">émissions</text>
  <rect x="${boxesX}" y="${boxY}" width="${energyBoxW}" height="${boxH}" fill="white" stroke="#151515" stroke-width="3"/>
  <rect x="${boxesX + energyBoxW + boxGap}" y="${boxY}" width="${co2BoxW}" height="${boxH}" fill="white" stroke="#151515" stroke-width="3"/>
  <text x="${boxesX + energyBoxW / 2}" y="${valueMidY - 4}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="40" font-weight="800" fill="#111">${kwhDisplay}</text>
  <text x="${boxesX + energyBoxW / 2}" y="${boxY + boxH - 18}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" fill="#222">kWh/m&#178;.an</text>
  <text x="${boxesX + energyBoxW + co2BoxW / 2}" y="${valueMidY - 4}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="40" font-weight="800" fill="#111">${co2Display}</text>
  <text x="${boxesX + energyBoxW + co2BoxW / 2}" y="${boxY + boxH - 18}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" fill="#222">kg CO&#8322;/m&#178;/an</text>
  ${passoire}
  ${bars}
  ${activeBar}
  <text x="266" y="${diagramBottom + 56}" font-family="Arial,Helvetica,sans-serif" font-size="25" font-weight="700" fill="#e0272b">Logement extrêmement peu performant</text>
</svg>`;
}

function buildClimateSvg(
  activeLetter: string,
  climateValue: string,
  options: { showFrame: boolean; frameColor: string; showBackground: boolean; backgroundColor: string }
): string {
  const activeIndex = LETTERS.indexOf(activeLetter.toUpperCase() as Letter);
  const currentIndex = activeIndex >= 0 ? activeIndex : 1;
  const viewWidth = 760;
  const viewHeight = 760;
  const firstBarY = 176;
  const barX = 36;
  const widths = [130, 160, 190, 222, 252, 284, 326];
  const normalH = 58;
  const activeH = 106;
  const rowGap = 4;
  const activeRowExtraGap = 6;
  const unitDisplay = climateValue ? esc(climateValue) : "-";

  let bars = "";
  let activeBar = "";
  let activeEnd = 0;
  let activeMidY = 0;
  const rowHeights = LETTERS.map((_, index) => (index === currentIndex ? activeH : normalH));
  const rowYs: number[] = [];
  let cursorY = firstBarY;
  for (let index = 0; index < LETTERS.length; index++) {
    if (index === currentIndex) {
      cursorY += activeRowExtraGap / 2;
    }
    rowYs.push(cursorY);
    cursorY += rowHeights[index] + rowGap + (index === currentIndex ? activeRowExtraGap / 2 : 0);
  }
  const diagramBottom = cursorY - rowGap;
  for (let index = 0; index < LETTERS.length; index++) {
    const letter = LETTERS[index];
    const isActive = index === currentIndex;
    const height = rowHeights[index];
    const y = rowYs[index];
    if (isActive) {
      activeBar = drawClimateBar(letter, barX, y, widths[index], height, true);
    } else {
      bars += drawClimateBar(letter, barX, y, widths[index], height, false);
    }
    if (isActive) {
      activeEnd = barX + widths[index];
      activeMidY = y + height / 2;
    }
  }

  const lineStart = activeEnd + 14;
  const lineEnd = lineStart + 28;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${viewHeight}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;">
  ${buildFrame(viewWidth, viewHeight, options)}
  <text x="38" y="66" font-family="Arial,Helvetica,sans-serif" font-size="36" font-weight="700" fill="#111">Performance climatique</text>
  <text x="38" y="118" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="700" fill="#111">*Dont émissions de gaz à effet de serre</text>
  <text x="38" y="156" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="700" fill="#c7e6fb">Peu d'émissions de CO&#8322;</text>
  ${bars}
  ${activeBar}
  <line x1="${lineStart}" y1="${activeMidY}" x2="${lineEnd}" y2="${activeMidY}" stroke="#111" stroke-width="4" stroke-linecap="round"/>
  <text x="${lineEnd + 14}" y="${activeMidY + 2}" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="700" fill="#111" dominant-baseline="central">${unitDisplay}</text>
  <text x="${lineEnd + 106}" y="${activeMidY + 2}" font-family="Arial,Helvetica,sans-serif" font-size="25" font-weight="700" fill="#111" dominant-baseline="central">kg CO&#8322;/m&#178;/an</text>
  <text x="38" y="${diagramBottom + 44}" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="700" fill="#342b4a">Émissions de CO&#8322; très importante</text>
</svg>`;
}

export type DpeVariant = "energy" | "climate";

export function buildDpeSvg(params: {
  variant: DpeVariant;
  energyLetter?: string;
  energyValue?: string;
  climateLetter?: string;
  climateValue?: string;
  showFrame?: boolean;
  frameColor?: string;
  showBackground?: boolean;
  backgroundColor?: string;
}): string {
  const options = {
    showFrame: params.showFrame ?? true,
    frameColor: params.frameColor ?? "#9a9a9a",
    showBackground: params.showBackground ?? true,
    backgroundColor: params.backgroundColor ?? "#ffffff",
  };
  if (params.variant === "climate") {
    return buildClimateSvg(params.climateLetter ?? "B", params.climateValue ?? "12", options);
  }
  return buildEnergySvg(params.energyLetter ?? "C", params.energyValue ?? "180", params.climateValue ?? "12", options);
}