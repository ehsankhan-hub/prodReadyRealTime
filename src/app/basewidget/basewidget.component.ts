import {AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {BaseWidget} from '@int/geotoolkit/widgets/BaseWidget';
import {Plot} from '@int/geotoolkit/plot/Plot';

/**
 * Base component for hosting GeoToolkit widgets.
 * Provides a canvas element and manages the Plot instance for rendering.
 * 
 * @remarks
 * This component serves as a wrapper for GeoToolkit widgets, providing:
 * - Canvas element for rendering
 * - Plot instance for widget management
 * - Automatic sizing and updates
 * - Proper cleanup on component destruction
 */
@Component({
    selector: 'app-basewidget',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './basewidget.component.html',
    styleUrls: ['./basewidget.component.css']
})
export class BaseWidgetComponent implements OnInit, AfterViewInit, OnDestroy {
    /** Reference to the canvas element for rendering */
    @ViewChild('plot', {static: true})
    protected _canvas!: ElementRef;
    /** GeoToolkit widget instance to be rendered */
    protected _widget!: BaseWidget;
    /** Plot instance that manages the canvas and widget */
    protected _plot!: Plot;

    /**
     * Creates an instance of BaseWidgetComponent.
     */
    constructor() {
        console.log('BaseWidgetComponent: Constructor called');
    }

    /**
     * Angular lifecycle hook called after component initialization.
     */
    ngOnInit() {
        console.log('BaseWidgetComponent: ngOnInit called');
    }

    /**
     * Gets the current GeoToolkit widget instance.
     * 
     * @returns The BaseWidget instance or undefined if not set
     */
    get Widget (): BaseWidget {
        return this._widget;
    }

    /**
     * Sets the GeoToolkit widget to be rendered.
     * Updates the Plot's root widget if the Plot is already created.
     * 
     * @param widget - The BaseWidget instance to render
     */
    set Widget (widget: BaseWidget) {
        console.log('BaseWidgetComponent: Widget setter called with:', widget?.constructor?.name);
        this._widget = widget;
        this._plot?.setRoot(this._widget);
    }

    /**
     * Gets the Plot instance managing the canvas and widget.
     * 
     * @returns The Plot instance or undefined if not created yet
     */
    get Plot (): Plot {
        return this._plot;
    }

    /**
     * Gets the canvas element reference.
     * 
     * @returns The ElementRef for the canvas
     */
    get Canvas (): ElementRef {
        return this._canvas;
    }

    /**
     * Gets the container element for the widget.
     * Provides access to the DOM element for resize calculations.
     * 
     * @returns The ElementRef for the container
     */
    get ContainerElement (): ElementRef {
        return this._canvas;
    }

    /**
     * Angular lifecycle hook called before component destruction.
     * Disposes the Plot to prevent memory leaks.
     */
    ngOnDestroy (): void {
        console.log('BaseWidgetComponent: ngOnDestroy called');
        this._plot?.dispose();
    }

    /**
     * Angular lifecycle hook called after the component view has been initialized.
     * Creates the Plot instance with the canvas element and widget.
     */
    ngAfterViewInit (): void {
        console.log('BaseWidgetComponent: ngAfterViewInit started');
        console.log('BaseWidgetComponent: _canvas element:', this._canvas);
        console.log('BaseWidgetComponent: _canvas.nativeElement:', this._canvas?.nativeElement);
        
        if (this._canvas && this._canvas.nativeElement) {
            console.log('BaseWidgetComponent: Creating Plot');
            this._plot = new Plot({
                canvaselement: this._canvas.nativeElement,
                autosize: true,
                root: this._widget ?? null,
                autoupdate: true
            });
            console.log('BaseWidgetComponent: Plot created successfully');
        } else {
            console.error('BaseWidgetComponent: Canvas element not found');
        }
    }
}
