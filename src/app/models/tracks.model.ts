export interface IMnemonic {
  mnemonicDescp: string;
  mnemonicId: string;
}

export interface ITracks {
  trackNo: number;
  trackName: string;
  trackType: string;
  trackWidth: number;
  isIndex: boolean;
  isDepth: boolean;
  curves: ICurve[];
}

export interface ICurve {
  mnemonicId: string;
  displayName: string;
  color: string;
  lineStyle: string;
  lineWidth: number;
  min: number;
  max: number;
  autoScale: boolean;
  show: boolean;
  LogId: string;
  data: any[];
  mnemonicLst: IMnemonic[];
}
