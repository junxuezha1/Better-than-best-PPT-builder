import { Resvg } from "@resvg/resvg-js";

/** Project-authored calibration image. No user asset, downloaded photo, font,
 * external resource or additional license is needed to reproduce this fixture. */
export function sampleImage(): Buffer {
  return new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#E7EDF5"/><rect width="320" height="180" fill="#1664FF"/><rect x="320" width="320" height="180" fill="#0F2C59"/><rect y="180" width="320" height="180" fill="#89B5FF"/><rect x="320" y="180" width="320" height="180" fill="#E7EDF5"/><circle cx="320" cy="180" r="98" fill="white"/><circle cx="320" cy="180" r="52" fill="#1664FF"/><path d="M0 180H640 M320 0V360" stroke="#13243A" stroke-width="4"/><rect x="12" y="12" width="616" height="336" fill="none" stroke="white" stroke-width="8"/></svg>').render().asPng();
}
