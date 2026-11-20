/** Where a video with `object-fit: contain` sits inside the player box, including the black bars. */
export function fittedPicture(boxW: number, boxH: number, mediaW: number, mediaH: number): { left: number; top: number; width: number; height: number } {
  if (!(boxW > 0) || !(boxH > 0) || !(mediaW > 0) || !(mediaH > 0)) {
    return { left: 0, top: 0, width: boxW > 0 ? boxW : 0, height: boxH > 0 ? boxH : 0 };
  }
  const scale = Math.min(boxW / mediaW, boxH / mediaH);
  const width = mediaW * scale;
  const height = mediaH * scale;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width: width, height: height };
}
