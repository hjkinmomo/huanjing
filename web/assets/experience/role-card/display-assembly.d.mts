export type DisplaySpec={id:string;ink?:string;nameAt?:number[];assemblyOverrides?:ReadonlyArray<{sourceBox:number[];rect?:number[];depth?:number;limit?:number}>};
export type DisplayPiece={id:string;kind:string;rect:number[];depth:number;limit:number;canvas:HTMLCanvasElement;sourceBox?:number[]};
export function assembleDisplay(image:HTMLImageElement,spec:DisplaySpec,name:string):DisplayPiece[];
export function drawDisplayPreview(canvas:HTMLCanvasElement,pieces:DisplayPiece[]):void;
