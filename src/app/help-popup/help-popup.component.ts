import { Component, EventEmitter, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-help-popup',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatButtonModule],
  templateUrl: './help-popup.component.html',
  styleUrl: './help-popup.component.css',
})
export class HelpPopupComponent {
  @Output() close = new EventEmitter<void>();

  onClose(): void {
    this.close.emit();
  }
}
