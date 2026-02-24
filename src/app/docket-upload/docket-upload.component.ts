import { Component, inject, Input, OnInit, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  Storage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from '@angular/fire/storage';
import { getAuth } from 'firebase/auth';
import { EnvironmentInjector } from '@angular/core';

/**
 * DocketUploadComponent — Standalone component for attaching a docket (PDF or photo)
 * to a trip during confirmation.
 *
 * LEARNING: OUTPUT SIGNALS
 * We use Angular's `output()` function (introduced in Angular 17) to emit typed
 * events to the parent. The parent subscribes in the template, e.g.
 * `(docketUploaded)="onDocketUploaded($event)"`.
 *
 * LEARNING: CANVAS-BASED IMAGE RESIZE
 * We deliberately do NOT send raw phone photos (often 10–15MB) to Firebase Storage.
 * Instead we draw the image onto a hidden <canvas> at a max-width of 1280px and
 * export it as a JPEG at 85% quality. This reliably produces files in the
 * 300KB–800KB range regardless of the original camera resolution.
 */
@Component({
  selector: 'app-docket-upload',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  templateUrl: './docket-upload.component.html',
  styleUrl: './docket-upload.component.css',
})
export class DocketUploadComponent implements OnInit {

  // ============================================================
  // INPUTS: Context from the parent (CreateChargeDialogComponent)
  // ============================================================

  /** Firestore trip ID — determines Storage path: dockets/{tripId}/{filename} */
  @Input({ required: true }) tripId!: string;

  /** Existing docket URL if this trip already has one (shown as preview) */
  @Input() existingDocketUrl?: string;

  /** Existing storage path — deleted when pilot replaces the docket */
  @Input() existingDocketPath?: string;

  /** Type of the existing docket for rendering the correct preview */
  @Input() existingDocketType?: 'image' | 'pdf';

  // ============================================================
  // OUTPUTS: Emit upload results to parent so it can include
  // them in the Firestore save payload.
  // ============================================================

  /** Fired once the file is fully uploaded. Parent stores this in the Trip. */
  readonly docketUploaded = output<{
    docketUrl: string;
    docketPath: string;
    docketType: 'image' | 'pdf';
  }>();

  /** Fired when the upload state changes — parent disables "Save" while true */
  readonly uploadingChange = output<boolean>();

  // ============================================================
  // INTERNAL STATE (Signals)
  // ============================================================

  /** Whether a file upload is currently in progress */
  readonly uploading = signal(false);

  /** URL of the already-uploaded docket (used for preview) */
  readonly currentDocketUrl = signal<string | undefined>(undefined);

  /** Storage path of the current docket */
  readonly currentDocketPath = signal<string | undefined>(undefined);

  /** Type of the current docket */
  readonly currentDocketType = signal<'image' | 'pdf' | undefined>(undefined);

  // ============================================================
  // DEPENDENCIES
  // ============================================================
  private readonly storage = inject(Storage);
  private readonly snackBar = inject(MatSnackBar);
  private readonly injector = inject(EnvironmentInjector);

  ngOnInit(): void {
    // Pre-populate from the existing docket if available (e.g. editing a trip)
    this.currentDocketUrl.set(this.existingDocketUrl);
    this.currentDocketPath.set(this.existingDocketPath);
    this.currentDocketType.set(this.existingDocketType);
  }

  // ============================================================
  // PUBLIC INTERFACE: called from template
  // ============================================================

  /** Opens the native OS file picker when the button is clicked */
  triggerFilePicker(fileInput: HTMLInputElement): void {
    fileInput.click();
  }

  /**
   * Main entry point: called when the user selects a file.
   *
   * FLOW:
   * 1. Validate MIME type
   * 2. For images → resize via Canvas
   *    For PDFs   → check size ≤ 1.5MB
   * 3. Upload to Firebase Storage
   * 4. Emit the result to the parent
   * 5. If a previous docket exists, delete it from Storage
   */
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // Reset the input value so selecting the same file again still fires (change) event
    input.value = '';

    if (!file) return;

    const isImage = file.type === 'image/jpeg' || file.type === 'image/png';
    const isPdf   = file.type === 'application/pdf';

    if (!isImage && !isPdf) {
      this.snackBar.open('Unsupported file type. Please attach a JPEG, PNG, or PDF.', 'Close', { duration: 5000 });
      return;
    }

    // PDF size guard — 1.5MB limit
    if (isPdf && file.size > 1.5 * 1024 * 1024) {
      this.snackBar.open('PDF must be under 1.5MB. Please compress the file and try again.', 'Close', { duration: 6000 });
      return;
    }

    this.setUploading(true);

    try {
      // Determine the blob to upload: resized image or raw PDF
      const uploadBlob: Blob = isImage
        ? await this.resizeImage(file)
        : file;

      const ext        = isImage ? 'jpg' : 'pdf';
      const timestamp  = Date.now();
      const storagePath = `dockets/${this.tripId}/docket_${timestamp}.${ext}`;

      // 1. Hold a reference to the OLD path before we overwrite the signal
      const previousPath = this.currentDocketPath();

      // DEFENSIVE: Ensure we can actually read the file (rules out Drive sync issues)
      const testBuffer = await file.slice(0, 100).arrayBuffer();
      if (testBuffer.byteLength === 0) {
        throw new Error('File is empty or could not be read. If this is a Google Drive file, please make sure it is downloaded to your device.');
      }

      // DEBUG LOGGING: Verify identity and bucket
      const auth = getAuth();
      console.log('--- STORAGE DEBUG ---');
      console.log('Current User:', auth.currentUser?.uid || 'NOT LOGGED IN');
      console.log('Target Bucket:', (this.storage as any)._bucket || (this.storage as any).storage?.app?.options?.storageBucket || 'Unknown');
      console.log('Target Path:', storagePath);

      // 2. Upload the new file — Simple POST upload (more robust for CORS)
      const storageRef = ref(this.storage, storagePath);
      
      // Explicitly pass contentType metadata — this often fixes 412 errors
      const metadata = { contentType: isImage ? 'image/jpeg' : 'application/pdf' };
      
      await uploadBytes(storageRef, uploadBlob, metadata);

      const downloadUrl = await getDownloadURL(storageRef);

      // 3. Update internal state ONLY after a successful upload (atomic safety)
      const docketType: 'image' | 'pdf' = isImage ? 'image' : 'pdf';
      this.currentDocketUrl.set(downloadUrl);
      this.currentDocketPath.set(storagePath);
      this.currentDocketType.set(docketType);

      // 4. Tell the parent about the successful upload
      this.docketUploaded.emit({
        docketUrl: downloadUrl,
        docketPath: storagePath,
        docketType,
      });

      // 5. Clean up the OLD file AFTER the new one is safe — never delete before upload succeeds
      if (previousPath) {
        await this.deletePreviousDocket(previousPath);
      }

      this.snackBar.open('Docket attached successfully.', 'OK', { duration: 3000 });

    } catch (error: unknown) {
      console.error('Docket upload failed:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.snackBar.open(`Upload failed: ${msg}`, 'Close', { duration: 7000 });
    } finally {
      this.setUploading(false);
    }
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  /**
   * Resizes an image file to a max-width of 1280px using the HTML5 Canvas API.
   *
   * LEARNING: WHY CANVAS INSTEAD OF OffscreenCanvas?
   * OffscreenCanvas is not supported in all mobile browsers (especially older iOS/Android).
   * A hidden <canvas> element is 100% compatible, runs synchronously on the main thread,
   * and is more than fast enough for a single image resize on a mobile device.
   *
   * QUALITY: We export at 85% JPEG quality which reliably compresses phone photos
   * from 10MB+ down to 400KB–800KB while remaining visually indistinguishable.
   *
   * @param file - The raw image File from the picker
   * @returns A Promise resolving to a Blob at the target dimensions
   */
  private resizeImage(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const MAX_WIDTH = 1280;
      const JPEG_QUALITY = 0.85;

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl); // Free the object URL immediately after loading

        // Calculate target dimensions, respecting aspect ratio
        let width  = img.naturalWidth;
        let height = img.naturalHeight;

        if (width > MAX_WIDTH) {
          height = Math.round(height * (MAX_WIDTH / width));
          width  = MAX_WIDTH;
        }

        // Draw onto a hidden canvas at the new size
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Could not get Canvas 2D context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Canvas toBlob returned null'));
              return;
            }
            resolve(blob);
          },
          'image/jpeg',
          JPEG_QUALITY
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image for resizing'));
      };

      img.src = objectUrl;
    });
  }

  /**
   * Deletes a previous docket from Firebase Storage.
   * Called ONLY after the new file has been successfully uploaded.
   * Errors here are non-fatal — we log them but don't fail the whole upload.
   */
  private async deletePreviousDocket(path: string): Promise<void> {
    try {
      const oldRef = ref(this.storage, path);
      await deleteObject(oldRef);
    } catch (error) {
      // Non-fatal: the old file may have already been deleted manually
      console.warn('Could not delete previous docket from Storage:', error);
    }
  }

  /** Centralized setter so we always emit the change event alongside the signal */
  private setUploading(value: boolean): void {
    this.uploading.set(value);
    this.uploadingChange.emit(value);
  }
}
