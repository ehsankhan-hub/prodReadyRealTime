import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GenerateCanvasTimeTracksComponent } from './generate-canvas-time-tracks.component';

describe('GenerateCanvasTimeTracksComponent', () => {
  let component: GenerateCanvasTimeTracksComponent;
  let fixture: ComponentFixture<GenerateCanvasTimeTracksComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GenerateCanvasTimeTracksComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GenerateCanvasTimeTracksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
