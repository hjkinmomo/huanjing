export const PUZZLE_SCENES=Object.freeze({
 bunny:{id:'bunny',name:'兔子花园',group:'简洁图画',image:'./media/play-painted-v2/puzzle-bunny.png'},
 lighthouse:{id:'lighthouse',name:'海边灯塔',group:'风景插画',image:'./media/play-painted-v2/puzzle-lighthouse.png'},
 cottage:{id:'cottage',name:'星夜小屋',group:'风景插画',image:'./media/play-painted-v2/puzzle-cottage.png'},
 garden:{id:'garden',name:'郁金花间',group:'风景插画',image:'./media/play-painted-v2/puzzle-garden.png'},
 rose:{id:'rose',name:'玫瑰温室',image:'./media/play-painted-v2/puzzle-rose.png'},
 sun:{id:'sun',name:'晴日茶间',image:'./media/play-painted-v2/puzzle-sun.png'},
 ink:{id:'ink',name:'月下书斋',image:'./media/play-painted-v2/puzzle-ink.png'}
});
export function puzzleScene(roleId,sceneId){return Object.hasOwn(PUZZLE_SCENES,sceneId)?PUZZLE_SCENES[sceneId]:PUZZLE_SCENES[roleId==='koka'?'sun':roleId==='shuyun'?'ink':'rose'];}
export function tilePosition(value,size=3){if(![3,4,5].includes(size)||!Number.isInteger(value)||value<1||value>=size*size)return null;return {x:((value-1)%size)*100/(size-1),y:Math.floor((value-1)/size)*100/(size-1)};}
export const MEMORY_BACK='./media/expression-art-v1/memory-back.png';
