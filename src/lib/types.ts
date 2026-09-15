export type Category = 'gemel' | 'hishtalmut' | 'policy' | 'pension';
export type Fund = { id:string; category:Category; name:string; company:string; track:string; managementFeeDeposit:number|null; managementFeeSavings:number|null; returnYTD:number|null; return1Y:number|null; return3Y:number|null; return5Y:number|null; totalAssets:number|null; history:{month:string;return:number}[] };
export type CategoryFile = { lastUpdated:string; sourceMonth:string; source:string; funds:Fund[] };
