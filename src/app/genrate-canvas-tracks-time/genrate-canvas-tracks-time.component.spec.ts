import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GenrateCanvasTracksTimeComponent } from './genrate-canvas-tracks-time.component';

describe('GenrateCanvasTracksTimeComponent', () => {
  let component: GenrateCanvasTracksTimeComponent;
  let fixture: ComponentFixture<GenrateCanvasTracksTimeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GenrateCanvasTracksTimeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GenrateCanvasTracksTimeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
