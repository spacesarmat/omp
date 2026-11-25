export interface SarifLocation {
  physicalLocation?: { artifactLocation?: { uri?: string } };
}

export interface SarifResult {
  locations?: SarifLocation[];
  location?: SarifLocation;
  relatedLocations?: SarifLocation[];
  codeFlows?: { threadFlows?: { locations?: SarifLocation[] }[] }[];
}

export interface SarifRun {
  results?: SarifResult[];
  [key: string]: unknown;
}

export interface SarifDoc {
  runs?: SarifRun[];
  [key: string]: unknown;
}

export function thirdParty(result: SarifResult): boolean;
export function filterSarif(text: string): { doc: SarifDoc; dropped: number };
export function filterDir(dir: string): { file: string; dropped: number }[];
