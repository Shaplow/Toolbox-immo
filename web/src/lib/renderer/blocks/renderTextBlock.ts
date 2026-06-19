import type { SchemaField, TextBlock } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { formatPrice } from "@/types/listing";
import { compileTextTemplate, resolveTextTemplate } from "@/lib/textTemplate";
import { resolveSystemTokens } from "@/lib/systemTokens";
import { formatConfiguredNumber, toFlexibleNumber } from "@/lib/numberFormatting";
import { getPerLineTextEffectiveRadius, getPerLineTextGooFilterId, getPerLineTextSideBridgeMetrics, shouldApplyPerLineTextGoo } from "@/lib/perLineTextBackground";
import { getTextBackgroundBorderRadius, getTextBackgroundMode, getTextBackgroundPadding, getTextBackgroundSize, getTextContentPadding, isTextBackgroundEnabled } from "@/lib/textBackground";
import { blockBaseStyle, buildTextShadowValue, buildTextStrokeValue, getFauxThinErodeRadius, getFauxThinFilterId, getOpaqueTextBackgroundColor, getTextBackgroundFill } from "../styleUtils";

export function renderTextBlock(
  block: TextBlock,
  listing: ListingData,
  schema?: SchemaField[],
  _options?: { autoLayout?: boolean }
): string {
  void _options;
  let text = "";
  const resolvedContent = block.content ?? (block.contentSegments ? compileTextTemplate(block.contentSegments) : undefined);

  if (resolvedContent !== undefined) {
    text = resolveTextTemplate(resolvedContent, listing, schema);
  } else if (block.binding) {
    // Backward compat: single binding
    const raw = listing[block.binding];
    const numericValue = toFlexibleNumber(raw);
    if (block.binding === "price_eur" && numericValue !== null) {
      text = formatPrice(numericValue);
    } else if (numericValue !== null) {
      const field = schema?.find((item) => item.key === block.binding);
      text = field?.type === "number"
        ? (formatConfiguredNumber(raw, {
            formatThousands: field.formatThousands,
            decimalSeparator: field.decimalSeparator,
          }) ?? String(raw))
        : String(raw);
    } else {
      text = String(raw ?? "");
    }
  } else {
    text = block.staticText ?? "";
  }

  text = resolveSystemTokens(text);

  const { rules, style } = block;
  const vAlign = style.verticalAlign ?? "top";
  const justifyContent =
    vAlign === "middle" ? "center" : vAlign === "bottom" ? "flex-end" : "flex-start";
  const backgroundEnabled = isTextBackgroundEnabled(style);
  const backgroundMode = getTextBackgroundMode(style);
  const backgroundSize = getTextBackgroundSize(style, block.w, block.h);
  const contentPadding = getTextContentPadding(style);
  const backgroundPadding = getTextBackgroundPadding(style);
  const backgroundRadius = getTextBackgroundBorderRadius(style);

  // Outer div: handles position and vertical placement inside the text block.
  const outerParts: string[] = [
    blockBaseStyle(block),
    `display:flex;flex-direction:column;justify-content:${justifyContent}`,
  ];
  const outerStyle = outerParts.join(";");

  // Inner div: handles typography, padding, line-clamp.
  const innerParts: string[] = [];
  if (style.fontFamily)  innerParts.push(`font-family:'${style.fontFamily}',sans-serif`);
  if (style.fontSize)    innerParts.push(`font-size:${style.fontSize}pt`);
  if (style.fontWeight)  innerParts.push(`font-weight:${style.fontWeight}`);
  if (style.fontStyle)   innerParts.push(`font-style:${style.fontStyle}`);
  if (style.color)       innerParts.push(`color:${style.color}`);
  const fauxBold = buildTextStrokeValue(style, style.color ?? "#000000");
  if (fauxBold)          innerParts.push(`-webkit-text-stroke:${fauxBold}`);
  const erodeRadius = getFauxThinErodeRadius(style);
  if (erodeRadius > 0)   innerParts.push(`filter:url(#${getFauxThinFilterId(erodeRadius)})`);
  if (style.letterSpacing !== undefined) innerParts.push(`letter-spacing:${style.letterSpacing}px`);
  const textShadow = buildTextShadowValue(style);
  if (textShadow)        innerParts.push(`text-shadow:${textShadow}`);
  if (style.textAlign)   innerParts.push(`text-align:${style.textAlign}`);
  if (contentPadding.top === contentPadding.right && contentPadding.top === contentPadding.bottom && contentPadding.top === contentPadding.left) {
    if (contentPadding.top > 0) innerParts.push(`padding:${contentPadding.top}px`);
  } else {
    if (contentPadding.top > 0) innerParts.push(`padding-top:${contentPadding.top}px`);
    if (contentPadding.right > 0) innerParts.push(`padding-right:${contentPadding.right}px`);
    if (contentPadding.bottom > 0) innerParts.push(`padding-bottom:${contentPadding.bottom}px`);
    if (contentPadding.left > 0) innerParts.push(`padding-left:${contentPadding.left}px`);
  }

  if (rules.maxLines) {
    innerParts.push(
      `display:-webkit-box;-webkit-line-clamp:${rules.maxLines};-webkit-box-orient:vertical;overflow:hidden`
    );
  }
  if (rules.uppercase) innerParts.push("text-transform:uppercase");
  innerParts.push("line-height:normal");
  innerParts.push("white-space:pre-wrap");
  innerParts.push("box-sizing:border-box");
  // Opacité du texte seul (glyphes + ombre) — appliquée à l'élément texte, pas au fond.
  // Concerne les modes "sans fond" et "fit/fixed" (le mode per-line a son propre élément texte).
  if (style.textOpacity !== undefined) innerParts.push(`opacity:${style.textOpacity}`);
  if (backgroundEnabled && backgroundMode === "fixed") innerParts.push("width:100%");

  const innerStyle = innerParts.join(";");

  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // ── No background ──────────────────────────────────────────────────────────
  if (!backgroundEnabled) {
    const plainStyle = style.opacity !== undefined ? `opacity:${style.opacity}` : "";
    return `<div class="block block-text" data-text-background-mode="none" data-shrink-to-fit="${rules.shrinkToFit && rules.minFontSize ? "true" : "false"}" data-min-font-size="${rules.minFontSize ?? ""}" style="${outerStyle}"><div style="${plainStyle}"><div class="block-text-content" style="${innerStyle}">${escaped}</div></div></div>`;
  }

  // Background box is always horizontally centered in the block frame.
  // Text alignment within the box is controlled separately via innerStyle (text-align).
  const alignStyle = `width:100%;display:flex;justify-content:center`;

  // ── Per-line mode ──────────────────────────────────────────────────────────
  if (backgroundMode === "per-line") {
    const spanParts: string[] = [];
    const textAlign = style.textAlign ?? "left";
    const backgroundFill = getTextBackgroundFill(style);
    const effectiveBackgroundRadius = getPerLineTextEffectiveRadius(backgroundRadius);
    const shouldApplyPerLineGoo = shouldApplyPerLineTextGoo(backgroundRadius);
    const perLineGooFilterId = shouldApplyPerLineGoo ? getPerLineTextGooFilterId(backgroundRadius) : null;
    const bridgeMetrics = textAlign === "left"
      ? getPerLineTextSideBridgeMetrics(effectiveBackgroundRadius, backgroundPadding.left)
      : textAlign === "right"
        ? getPerLineTextSideBridgeMetrics(effectiveBackgroundRadius, backgroundPadding.right)
        : { inset: 0, width: 0 };
    if (style.fontFamily) spanParts.push(`font-family:'${style.fontFamily}',sans-serif`);
    if (style.fontSize) spanParts.push(`font-size:${style.fontSize}pt`);
    if (style.fontWeight) spanParts.push(`font-weight:${style.fontWeight}`);
    if (style.fontStyle)  spanParts.push(`font-style:${style.fontStyle}`);
    if (style.color) spanParts.push(`color:${style.color}`);
    const fauxBoldPL = buildTextStrokeValue(style, style.color ?? "#000000");
    if (fauxBoldPL) spanParts.push(`-webkit-text-stroke:${fauxBoldPL}`);
    if (style.letterSpacing !== undefined) spanParts.push(`letter-spacing:${style.letterSpacing}px`);
    const textShadowPL = buildTextShadowValue(style);
    if (textShadowPL) spanParts.push(`text-shadow:${textShadowPL}`);
    if (style.textAlign) spanParts.push(`text-align:${style.textAlign}`);
    if (rules.uppercase) spanParts.push("text-transform:uppercase");
    spanParts.push(`background-color:${backgroundFill}`);
    spanParts.push("display:inline");
    spanParts.push("box-decoration-break:clone");
    spanParts.push("-webkit-box-decoration-break:clone");
    spanParts.push("white-space:pre-wrap");
    spanParts.push("box-sizing:border-box");
    if (effectiveBackgroundRadius > 0) spanParts.push(`border-radius:${effectiveBackgroundRadius}px`);
    if (style.opacity !== undefined) spanParts.push(`opacity:${style.opacity}`);

    const vPad = backgroundPadding.top + backgroundPadding.bottom;
    if (vPad > 0) spanParts.push(`line-height:calc(1em + ${vPad}px)`);
    if (backgroundPadding.top === backgroundPadding.right && backgroundPadding.top === backgroundPadding.bottom && backgroundPadding.top === backgroundPadding.left) {
      if (backgroundPadding.top > 0) spanParts.push(`padding:${backgroundPadding.top}px`);
    } else {
      if (backgroundPadding.top > 0) spanParts.push(`padding-top:${backgroundPadding.top}px`);
      if (backgroundPadding.right > 0) spanParts.push(`padding-right:${backgroundPadding.right}px`);
      if (backgroundPadding.bottom > 0) spanParts.push(`padding-bottom:${backgroundPadding.bottom}px`);
      if (backgroundPadding.left > 0) spanParts.push(`padding-left:${backgroundPadding.left}px`);
    }

    // ── Cas transparent + arrondi : rendu double couche ──────────────────────
    // Sous opacité de fond < 1 avec coins arrondis, le goo (seuil alpha) casse
    // si on lui donne un fond rgba semi-transparent. On garde la fusion blob en
    // séparant : couche FOND (fill plein → goo net → fondue UNE fois via opacity)
    // + couche TEXTE opaque par-dessus. Tous les autres cas restent inchangés.
    const dualLayer = backgroundRadius > 0 && (style.backgroundOpacity ?? 1) < 1;
    if (dualLayer) {
      const opaqueFill = getOpaqueTextBackgroundColor(style);
      const bgOpacity = style.backgroundOpacity ?? 1;

      // Géométrie partagée par les 2 couches → wrapping strictement identique.
      const geom: string[] = [];
      if (style.fontFamily) geom.push(`font-family:'${style.fontFamily}',sans-serif`);
      if (style.fontSize) geom.push(`font-size:${style.fontSize}pt`);
      if (style.fontWeight) geom.push(`font-weight:${style.fontWeight}`);
      if (style.fontStyle) geom.push(`font-style:${style.fontStyle}`);
      if (style.letterSpacing !== undefined) geom.push(`letter-spacing:${style.letterSpacing}px`);
      if (style.textAlign) geom.push(`text-align:${style.textAlign}`);
      if (rules.uppercase) geom.push("text-transform:uppercase");
      geom.push("display:inline", "box-decoration-break:clone", "-webkit-box-decoration-break:clone", "white-space:pre-wrap", "box-sizing:border-box");
      if (vPad > 0) geom.push(`line-height:calc(1em + ${vPad}px)`);
      if (backgroundPadding.top === backgroundPadding.right && backgroundPadding.top === backgroundPadding.bottom && backgroundPadding.top === backgroundPadding.left) {
        if (backgroundPadding.top > 0) geom.push(`padding:${backgroundPadding.top}px`);
      } else {
        if (backgroundPadding.top > 0) geom.push(`padding-top:${backgroundPadding.top}px`);
        if (backgroundPadding.right > 0) geom.push(`padding-right:${backgroundPadding.right}px`);
        if (backgroundPadding.bottom > 0) geom.push(`padding-bottom:${backgroundPadding.bottom}px`);
        if (backgroundPadding.left > 0) geom.push(`padding-left:${backgroundPadding.left}px`);
      }
      const geomStr = geom.join(";");

      // Couche FOND : fill plein + texte transparent (géométrie) + arrondi.
      const bgSpanStyle = [
        geomStr,
        `background-color:${opaqueFill}`,
        "color:transparent",
        effectiveBackgroundRadius > 0 ? `border-radius:${effectiveBackgroundRadius}px` : "",
      ].filter(Boolean).join(";");

      // Couche TEXTE : couleur visible + ombre + faux-gras (stroke/erode), pas de fond.
      const fauxBoldDual = buildTextStrokeValue(style, style.color ?? "#000000");
      const textShadowDual = buildTextShadowValue(style);
      const erodeRadiusDual = getFauxThinErodeRadius(style);
      const fgSpanStyle = [
        geomStr,
        style.color ? `color:${style.color}` : "",
        fauxBoldDual ? `-webkit-text-stroke:${fauxBoldDual}` : "",
        textShadowDual ? `text-shadow:${textShadowDual}` : "",
        erodeRadiusDual > 0 ? `filter:url(#${getFauxThinFilterId(erodeRadiusDual)})` : "",
      ].filter(Boolean).join(";");
      const fgInnerStyle = style.textOpacity !== undefined ? `opacity:${style.textOpacity}` : "";

      // maxLines : clamp identique sur chaque couche (le wrapper contient 2 divs).
      const layerClamp = rules.maxLines
        ? `display:-webkit-box;-webkit-line-clamp:${rules.maxLines};-webkit-box-orient:vertical;overflow:hidden`
        : "";

      const bridgeDual = bridgeMetrics.width > 0
        ? ["position:absolute", `top:${bridgeMetrics.inset}px`, `bottom:${bridgeMetrics.inset}px`, `width:${bridgeMetrics.width}px`, `background-color:${opaqueFill}`, textAlign === "left" ? "left:0" : "right:0"].join(";")
        : "";

      // Opacité du bloc entière → sur le wrapper (s'applique aux 2 couches).
      const wrapperDual = `width:100%;position:relative;text-align:${textAlign}${style.opacity !== undefined ? `;opacity:${style.opacity}` : ""}`;
      // Couche fond : goo + fondu (background opacity).
      const bgLayerStyle = ["position:relative", shouldApplyPerLineGoo && perLineGooFilterId ? `filter:url(#${perLineGooFilterId})` : "", `opacity:${bgOpacity}`, layerClamp].filter(Boolean).join(";");
      // Couche texte : superposée exactement, sans filtre ni opacité de fond.
      const textLayerStyle = ["position:absolute", "top:0", "left:0", "width:100%", "height:100%", `text-align:${textAlign}`, layerClamp].filter(Boolean).join(";");

      return `<div class="block block-text block-text-per-line" data-text-background-mode="per-line" data-shrink-to-fit="${rules.shrinkToFit && rules.minFontSize ? "true" : "false"}" data-min-font-size="${rules.minFontSize ?? ""}" style="${outerStyle}"><div class="block-text-align" style="${wrapperDual}"><div class="block-text-bg-layer" style="${bgLayerStyle}">${bridgeDual ? `<span aria-hidden="true" style="${bridgeDual}"></span>` : ""}<span class="block-text-background block-text-content text-bg-per-line" style="${bgSpanStyle}"><span>${escaped}</span></span></div><div class="block-text-fg-layer" style="${textLayerStyle}"><span class="block-text-content" style="${fgSpanStyle}"><span style="${fgInnerStyle}">${escaped}</span></span></div></div></div>`;
    }

    const spanStyle = spanParts.join(";");
    // Le faux-gras négatif (érosion) s'applique sur le span TEXTE interne, pas
    // sur le span de fond (sinon le cartouche serait rogné lui aussi).
    const erodeRadiusPL = getFauxThinErodeRadius(style);
    const textStyle = [
      "position:relative",
      style.textOpacity !== undefined ? `opacity:${style.textOpacity}` : "",
      erodeRadiusPL > 0 ? `filter:url(#${getFauxThinFilterId(erodeRadiusPL)})` : "",
    ].filter(Boolean).join(";");
    // Bugfix : en per-line mode, le wrapper portait toujours `overflow:visible`
    // et n'appliquait jamais le maxLines (qui était sur innerStyle, jamais utilisé
    // ici). On bascule sur display:-webkit-box + WebkitLineClamp quand maxLines
    // est défini — le span avec decoration-break:clone reste compatible.
    const perLineMaxLinesStyle = rules.maxLines
      ? `display:-webkit-box;-webkit-line-clamp:${rules.maxLines};-webkit-box-orient:vertical;overflow:hidden;`
      : "overflow:visible";
    const wrapperStyle = `width:100%;position:relative;text-align:${textAlign};${shouldApplyPerLineGoo && perLineGooFilterId ? `filter:url(#${perLineGooFilterId});` : ""}${perLineMaxLinesStyle}`;
    const bridgeStyle = bridgeMetrics.width > 0
      ? [
          "position:absolute",
          `top:${bridgeMetrics.inset}px`,
          `bottom:${bridgeMetrics.inset}px`,
          `width:${bridgeMetrics.width}px`,
          `background-color:${backgroundFill}`,
          style.opacity !== undefined ? `opacity:${style.opacity}` : "",
          textAlign === "left" ? "left:0" : "right:0",
        ].join(";")
      : "";

    return `<div class="block block-text block-text-per-line" data-text-background-mode="per-line" data-shrink-to-fit="${rules.shrinkToFit && rules.minFontSize ? "true" : "false"}" data-min-font-size="${rules.minFontSize ?? ""}" style="${outerStyle}"><div class="block-text-align" style="${wrapperStyle}">${bridgeStyle ? `<span aria-hidden="true" style="${bridgeStyle}"></span>` : ""}<span class="block-text-background block-text-content text-bg-per-line" style="${spanStyle}"><span style="${textStyle}">${escaped}</span></span></div></div>`;
  }

  // ── Fit / Fixed modes ──────────────────────────────────────────────────────
  const backgroundParts: string[] = [
    `background-color:${getTextBackgroundFill(style)}`,
    `display:${backgroundMode === "fixed" ? "flex" : "inline-flex"}`,
    "flex-direction:column",
    "max-width:100%",
    "max-height:100%",
    "overflow:hidden",
  ];
  if (backgroundRadius > 0) backgroundParts.push(`border-radius:${backgroundRadius}px`);
  if (style.opacity !== undefined) backgroundParts.push(`opacity:${style.opacity}`);
  backgroundParts.push("box-sizing:border-box");

  if (backgroundMode === "fixed") {
    backgroundParts.push(`justify-content:${justifyContent}`);
    backgroundParts.push(`width:${backgroundSize.width}px`);
    backgroundParts.push(`height:${backgroundSize.height}px`);
  } else {
    backgroundParts.push("width:fit-content");
  }
  if (backgroundPadding.top === backgroundPadding.right && backgroundPadding.top === backgroundPadding.bottom && backgroundPadding.top === backgroundPadding.left) {
    if (backgroundPadding.top > 0) backgroundParts.push(`padding:${backgroundPadding.top}px`);
  } else {
    if (backgroundPadding.top > 0) backgroundParts.push(`padding-top:${backgroundPadding.top}px`);
    if (backgroundPadding.right > 0) backgroundParts.push(`padding-right:${backgroundPadding.right}px`);
    if (backgroundPadding.bottom > 0) backgroundParts.push(`padding-bottom:${backgroundPadding.bottom}px`);
    if (backgroundPadding.left > 0) backgroundParts.push(`padding-left:${backgroundPadding.left}px`);
  }

  const backgroundStyle = backgroundParts.join(";");

  return `<div class="block block-text" data-text-background-mode="${backgroundMode}" data-shrink-to-fit="${rules.shrinkToFit && rules.minFontSize ? "true" : "false"}" data-min-font-size="${rules.minFontSize ?? ""}" style="${outerStyle}"><div class="block-text-align" style="${alignStyle}"><div class="block-text-background" style="${backgroundStyle}"><div class="block-text-content" style="${innerStyle}">${escaped}</div></div></div></div>`;
}
