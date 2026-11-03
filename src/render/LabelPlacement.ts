interface LabelBox { x: number; y: number; width: number; height: number; priority: number; element: HTMLElement }

/** A shared per-frame budget/collision space for cities, geography and tags. */
export class LabelPlacement {
 private boxes: LabelBox[] = [];
 private width = 0;
 private height = 0;
 private budget = 64;
 reset(width: number, height: number, budget: number): void {
  this.boxes = []; this.width = width; this.height = height; this.budget = budget;
 }
 place(x: number, y: number, width: number, height: number, priority: number, element: HTMLElement): boolean {
  if (this.width === 0) return true; // Standalone layers retain their existing API.
  if (x - width / 2 < 6 || x + width / 2 > this.width - 6 || y - height / 2 < 6 || y + height / 2 > this.height - 6) return false;
  const conflicts = this.boxes.filter(b => Math.abs(x-b.x) < (width+b.width)/2+6 && Math.abs(y-b.y) < (height+b.height)/2+6);
  if (conflicts.some(b => b.priority >= priority)) return false;
  const remaining = this.boxes.filter(b => !conflicts.includes(b));
  if (remaining.length >= this.budget) {
   const lowest = remaining.reduce<LabelBox | undefined>((a,b) => !a || b.priority < a.priority ? b : a, undefined);
   if (!lowest || lowest.priority >= priority) return false;
   lowest.element.hidden = true;
   remaining.splice(remaining.indexOf(lowest), 1);
  }
  for (const b of conflicts) b.element.hidden = true;
  this.boxes = [...remaining, { x,y,width,height,priority,element }];
  return true;
 }
}
/** Keep the selected bead clear of its label; side placement falls back above/below. */
export function cityLabelAnchor(x: number, y: number, labelWidth: number, width: number, height: number, important: boolean): { x: number; y: number } {
 let labelX=x, labelY=y-24;
 if (important) {
  if (x+22+labelWidth <= width-12) labelX=x+22+labelWidth/2;
  else if (x-22-labelWidth >= 12) labelX=x-22-labelWidth/2;
  else labelY=y < 60 ? y+42 : y-42;
 }
 return {x:Math.max(labelWidth/2+12,Math.min(width-labelWidth/2-12,labelX)),y:Math.max(24,Math.min(height-24,labelY))};
}
