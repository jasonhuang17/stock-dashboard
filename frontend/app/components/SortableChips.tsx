"use client";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, horizontalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function Chip({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="ticker-chip" {...attributes} {...listeners}>
      {id}
    </div>
  );
}

export function SortableChips({
  items,
  onReorder,
}: {
  items: string[];
  onReorder: (newOrder: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = items.indexOf(active.id as string);
      const newIdx = items.indexOf(over.id as string);
      onReorder(arrayMove(items, oldIdx, newIdx));
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={horizontalListSortingStrategy}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0" }}>
          {items.map(id => <Chip key={id} id={id} />)}
        </div>
      </SortableContext>
    </DndContext>
  );
}
