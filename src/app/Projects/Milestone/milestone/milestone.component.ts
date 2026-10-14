import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Thin shell that hosts the Configuration, Live and Archive routes (spec §6.2). */
@Component({
  selector: 'app-milestone',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './milestone.component.html',
  styleUrl: './milestone.component.css',
})
export class MilestoneComponent {}
