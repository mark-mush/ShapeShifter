import { Layer, LayerUtil, PathLayer } from 'app/model/layers';
import { ToolMode } from 'app/model/paper';
import { MathUtil } from 'app/scripts/common';
import { ClickDetector } from 'app/scripts/paper/detector';
import {
  AddDeleteHandlesGesture,
  BatchSelectItemsGesture,
  BatchSelectSegmentsGesture,
  CreateEllipseGesture,
  CreateRectangleGesture,
  Gesture,
  HoverItemsGesture,
  HoverSegmentsCurvesGesture,
  PencilGesture,
  ScaleItemsGesture,
  SelectDragCloneItemsGesture,
  SelectDragDrawSegmentsGesture,
  SelectDragHandleGesture,
} from 'app/scripts/paper/gesture';
import { PaperLayer } from 'app/scripts/paper/PaperLayer';
import { Guides, HitTests, Items, PivotType, Selections, Transforms } from 'app/scripts/paper/util';
import { PaperService } from 'app/services';
import * as paper from 'paper';

import { Tool } from './Tool';

/**
 * TODO: describe how 'enter' and 'escape' should both behave
 * TODO: https://medium.com/sketch-app/mastering-the-bezier-curve-in-sketch-4da8fdf0dbbb
 */
export class MasterTool extends Tool {
  private readonly paperLayer = paper.project.activeLayer as PaperLayer;
  private readonly clickDetector = new ClickDetector();
  private currentGesture: Gesture = new HoverItemsGesture(this.ps);

  constructor(private readonly ps: PaperService) {
    super();
  }

  // @Override
  onMouseEvent(event: paper.ToolEvent) {
    this.clickDetector.onMouseEvent(event);
    if (event.type === 'mousedown') {
      this.onMouseDown(event);
    } else if (event.type === 'mousedrag') {
      this.currentGesture.onMouseDrag(event);
    } else if (event.type === 'mousemove') {
      this.currentGesture.onMouseMove(event);
    } else if (event.type === 'mouseup') {
      this.onMouseUp(event);
    }
  }

  private onMouseDown(event: paper.ToolEvent) {
    const toolMode = this.ps.getToolMode();
    if (toolMode === ToolMode.Circle) {
      this.currentGesture = new CreateEllipseGesture(this.ps);
    } else if (toolMode === ToolMode.Rectangle) {
      this.currentGesture = new CreateRectangleGesture(this.ps);
    } else if (toolMode === ToolMode.Pencil) {
      this.currentGesture = new PencilGesture(this.ps);
    } else {
      // TODO: also add support for transform/rotate/etc. tools
      if (toolMode === ToolMode.Pen && !this.ps.getFocusedEditPath()) {
        // Then the user is in pen mode and is about to begin creating a new path.
        this.ps.setSelectedLayers(new Set());
        const vl = this.ps.getVectorLayer().clone();
        const pl = new PathLayer({
          name: LayerUtil.getUniqueLayerName([vl], 'path'),
          children: [] as Layer[],
          pathData: undefined,
          fillColor: '#000',
        });
        const children = [...vl.children, pl];
        vl.children = children;
        this.ps.setVectorLayer(vl);
        this.ps.setFocusedEditPath({
          layerId: pl.id,
          selectedSegments: new Set<number>(),
          visibleHandleIns: new Set<number>(),
          selectedHandleIns: new Set<number>(),
          visibleHandleOuts: new Set<number>(),
          selectedHandleOuts: new Set<number>(),
        });
      }
      if (this.ps.getFocusedEditPath()) {
        // The user is editing an existing focused edit path.
        this.currentGesture = this.createEditPathModeGesture(event);
      } else {
        // Otherwise we are in selection mode.
        this.currentGesture = this.createSelectionModeGesture(event);
      }
    }
    this.currentGesture.onMouseDown(event);
  }

  private onMouseUp(event: paper.ToolEvent) {
    this.currentGesture.onMouseUp(event);
    if (this.ps.getFocusedEditPath()) {
      this.currentGesture = new HoverSegmentsCurvesGesture(this.ps);
    } else {
      this.currentGesture = new HoverItemsGesture(this.ps);
    }
  }

  private createSelectionModeGesture(event: paper.ToolEvent) {
    const selectedLayers = this.ps.getSelectedLayers();
    if (selectedLayers.size > 0) {
      // First perform a hit test on the selection bounds.
      const res = this.paperLayer.hitTestSelectionBoundsItem(event.point);
      if (res) {
        // If the hit item is a selection bounds segment, then perform a scale gesture.
        // return new ScaleItemsGesture(this.ps, res.item.data.id as PivotType);

        // TODO: implement scaling!
        return new class extends Gesture {}();
      }
    }

    const hitResult = HitTests.selectionMode(event.point);
    if (!hitResult) {
      // If there is no hit item, then batch select items using a selection box box.
      return new BatchSelectItemsGesture(this.ps);
    }

    const hitItem = hitResult.item;
    if (this.clickDetector.isDoubleClick()) {
      // TODO: It should only be possible to enter edit path mode
      // for an editable item (i.e. a path, but not a group). Double clicking
      // on a non-selected and editable item that is contained inside a selected
      // parent layer should result in the editable item being selected (it is
      // actually a tiny bit more complicated than that but you get the idea).
      const hitPath = hitItem as paper.Path;

      // If a double click event occurs on top of a hit item, then enter edit path mode.
      this.ps.setSelectedLayers(new Set());
      this.ps.setFocusedEditPath({
        layerId: hitPath.data.id,
        // TODO: auto-select the last curve in the path
        selectedSegments: new Set<number>(),
        visibleHandleIns: new Set<number>(),
        selectedHandleIns: new Set<number>(),
        visibleHandleOuts: new Set<number>(),
        selectedHandleOuts: new Set<number>(),
      });
      return new class extends Gesture {}();
    }

    if (event.modifiers.shift && selectedLayers.has(hitItem.data.id) && selectedLayers.size > 1) {
      // TODO: After the item is deselected, it should still be possible
      // to drag/clone any other selected items in subsequent mouse events

      // If the hit item is selected, shift is pressed, and there is at least
      // one other selected item, then deselect the hit item.
      const layerIds = new Set(selectedLayers);
      layerIds.delete(hitItem.data.id);
      this.ps.setSelectedLayers(layerIds);
      return new class extends Gesture {}();
    }

    // TODO: The actual behavior in Sketch is a bit more complicated.
    // For example, (1) a cloned item will not be generated until the next
    // onMouseDrag event, (2) on the next onMouseDrag event, the
    // cloned item should be selected and the currently selected item should
    // be deselected, (3) the user can cancel a clone operation mid-drag by
    // pressing/unpressing alt (even if alt wasn't initially pressed in
    // onMouseDown).

    // At this point we know that either (1) the hit item is not selected
    // or (2) the hit item is selected, shift is not being pressed, and
    // there is only one selected item. In both cases the hit item should
    // end up being selected. If alt is being pressed, then we should
    // clone the item as well.
    return new SelectDragCloneItemsGesture(this.ps, hitItem);
  }

  private createEditPathModeGesture(event: paper.ToolEvent) {
    const focusedEditPath = this.ps.getFocusedEditPath();

    // First do a hit test on the underlying path's stroke/curves.
    const editPath = this.paperLayer.findItemByLayerId(focusedEditPath.layerId) as paper.Path;
    const strokeCurveHitResult = editPath.hitTest(
      paper.project.activeLayer.globalToLocal(event.point),
      { stroke: true, curves: true },
    );
    if (strokeCurveHitResult) {
      return new SelectDragDrawSegmentsGesture(this.ps, strokeCurveHitResult.location);
    }

    // Second, do a hit test on the focused edit path's segments and handles.
    const segmentHandleHitResult = this.paperLayer.hitTestFocusedEditPathItem(event.point);
    if (segmentHandleHitResult) {
      // We've hit a segment or a handle belonging to the focused edit path,
      // so begin a drag gesture.
      const rasterItem = segmentHandleHitResult.item as paper.Raster;
      const { segmentIndex, isHandleIn, isHandleOut } = rasterItem.data.focusedEditPath;
      if (isHandleIn || isHandleOut) {
        return new SelectDragHandleGesture(
          this.ps,
          segmentIndex,
          isHandleIn ? 'handle-in' : 'handle-out',
        );
      } else {
        if (this.clickDetector.isDoubleClick()) {
          // If a double click occurred on top of a segment,
          // then either create or delete its handles.
          return new AddDeleteHandlesGesture(this.ps, segmentIndex);
        }
        return new SelectDragDrawSegmentsGesture(this.ps, segmentIndex);
      }
    }

    if (
      // Then we are beginning to build a new path from scratch.
      editPath.segments.length === 0 ||
      // Then we are extending an existing open path.
      Selections.hasSingleSelectedEndPointSegment(editPath)
    ) {
      return new SelectDragDrawSegmentsGesture(this.ps);
    }

    // TODO: Only enter selection box mode when we are certain that a drag
    // has occurred. If a drag does not occur, then we should interpret the
    // gesture as a click. If a click occurs and shift is not pressed, then
    // we should exit edit path mode.

    // If there is no hit item and we are in edit path mode, then
    // enter selection box mode for the selected item so we can
    // batch select its individual properties.
    return new BatchSelectSegmentsGesture(this.ps);
  }

  // @Override
  onKeyEvent(event: paper.KeyEvent) {
    if (event.type === 'keydown') {
      this.currentGesture.onKeyDown(event);
    } else if (event.type === 'keyup') {
      this.currentGesture.onKeyUp(event);
    }
  }
}
