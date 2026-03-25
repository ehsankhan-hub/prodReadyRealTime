export interface ILogDataQueryParameter {
  wellUid?: string;
  objectId?:string;
  logUid?: string;
  wellboreUid?: string;
  logName?: string;
  indexType?: string;
  indexCurve?: string;
  startIndex?: string | number;
  endIndex?: string | number;
  isGrowing?: boolean;
  mnemonicList?: string;
}
