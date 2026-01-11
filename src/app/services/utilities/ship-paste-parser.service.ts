import { Injectable } from '@angular/core';
import { Port } from '../../models';

import { Timestamp } from '@angular/fire/firestore';

export interface ParsedShipData {
  shipName: string;
  grossTonnage: number;
  dwt?: number;
  loa?: number;
  beam?: number;
  draft?: number;
  eta: Date;
  berthPort: Port;
  rawText: string;
}

/**
 * Service to parse ship data from pasted port report text
 * Format: "S Breeze ARGO TT T 52454 30046 189.99 32.26 10.93 Trombets Eta 08/1800 A01 Bauxite Imports"
 */
@Injectable({
  providedIn: 'root'
})
export class ShipPasteParserService {

  /**
   * Parse pasted ship data text
   * @param pastedText Raw text from port report
   * @returns Parsed ship data or null if parsing fails
   */
  parseShipData(pastedText: string): ParsedShipData | null {
    try {
      const trimmed = pastedText.trim();
      if (!trimmed) return null;

      const parts = trimmed.split(/\s+/); // Split by whitespace
      
      // Find the agent (usually all caps word like ARGO, TRANSMED, etc.)
      // Ship name is all words before the agent
      let agentIndex = -1;
      for (let i = 1; i < parts.length; i++) {
        const word = parts[i];
        // Agent is typically all uppercase and not a number
        if (word === word.toUpperCase() && isNaN(Number(word)) && word.length > 2) {
          agentIndex = i;
          break;
        }
      }

      if (agentIndex === -1) {
        console.warn('Could not find agent in pasted text');
        return null;
      }

      // Ship name: all words before agent
      const shipName = parts.slice(0, agentIndex).join(' ');

      // After agent, we typically have: [TUG(s)] [LASTPORT] DWT GT LOA BEAM DRAFT Eta DD/HHMM BERTH [CARGO]
      let currentIndex = agentIndex + 1;

      // Skip ALL tug indicators (can be multiple: "TT T" or just "TT")
      // Tug codes start with T, are short (<=3 chars), and are not numbers
      while (currentIndex < parts.length && 
             parts[currentIndex].toUpperCase().startsWith('T') && 
             parts[currentIndex].length <= 3 &&
             isNaN(Number(parts[currentIndex]))) {
        currentIndex++;
      }

      // Skip last port (next word after tugs, before numbers)
      // Last port is a word that's not a number
      if (currentIndex < parts.length && isNaN(Number(parts[currentIndex]))) {
        currentIndex++; // Skip last port
      }

      // Extract numeric values (DWT, GT, LOA, Beam, Draft)
      const numbers: number[] = [];
      while (currentIndex < parts.length && !isNaN(Number(parts[currentIndex]))) {
        numbers.push(Number(parts[currentIndex]));
        currentIndex++;
      }

      if (numbers.length < 2) {
        console.warn('Not enough numeric data found');
        return null;
      }

      const dwt = numbers[0];
      const grossTonnage = numbers[1];
      const loa = numbers[2];
      const beam = numbers[3];
      const draft = numbers[4];

      // Find "Eta" keyword (after numbers)
      const etaIndex = parts.findIndex((p, i) => i >= currentIndex && p.toLowerCase() === 'eta');
      if (etaIndex === -1) {
        console.warn('Could not find ETA in pasted text');
        return null;
      }

      // ETA is next word after "Eta"
      const etaString = parts[etaIndex + 1];
      const eta = this.parseEta(etaString);
      if (!eta) {
        console.warn('Could not parse ETA:', etaString);
        return null;
      }

      // Find berth code by pattern (A**, F**, L**, S**, M**, T88)
      // Search from after ETA to end of array
      let berthCode: string | null = null;
      let berthPort: Port | null = null;
      
      for (let i = etaIndex + 2; i < parts.length; i++) {
        const word = parts[i].toUpperCase();
        // Check if this looks like a berth code
        if ((word.startsWith('A') || word.startsWith('F') || word.startsWith('L') || 
             word.startsWith('S') || word.startsWith('M') || word === 'T88') &&
            word.length >= 2 && word.length <= 4) {
          berthCode = parts[i];
          berthPort = this.parseBerthCode(berthCode);
          if (berthPort) {
            break; // Found valid berth
          }
        }
      }

      if (!berthPort || !berthCode) {
        console.warn('Could not find valid berth code after ETA');
        return null;
      }

      return {
        shipName,
        grossTonnage,
        dwt,
        loa,
        beam,
        draft,
        eta,
        berthPort,
        rawText: trimmed
      };

    } catch (error) {
      console.error('Error parsing ship data:', error);
      return null;
    }
  }

  /**
   * Parse ETA in format DD/HHMM
   * Assumes current or next month based on whether date is in the past
   */
  private parseEta(etaString: string): Date | null {
    try {
      // Format: DD/HHMM or DD/HH:MM
      const match = etaString.match(/^(\d{1,2})\/(\d{2})(\d{2})$/);
      if (!match) return null;

      const day = parseInt(match[1], 10);
      const hours = parseInt(match[2], 10);
      const minutes = parseInt(match[3], 10);

      const now = new Date();
      const currentDay = now.getDate();
      
      // Determine month/year
      let month = now.getMonth();
      let year = now.getFullYear();

      // If the day is less than current day, assume next month
      if (day < currentDay) {
        month++;
        if (month > 11) {
          month = 0;
          year++;
        }
      }

      const eta = new Date(year, month, day, hours, minutes);
      return eta;

    } catch (error) {
      console.error('Error parsing ETA:', error);
      return null;
    }
  }

  /**
   * Parse berth code to berth name
   * A** = Aughinish, F** = Foynes, L** = Limerick, S** = Shannon, M** = Moneypoint, T88 = Tarbert
   */
  private parseBerthCode(berthCode: string): Port | null {
    if (!berthCode) return null;

    const code = berthCode.toUpperCase();
    
    if (code.startsWith('A')) return 'Aughinish';
    if (code.startsWith('F')) return 'Foynes';
    if (code.startsWith('L')) return 'Limerick';
    if (code.startsWith('S')) return 'Shannon';
    if (code.startsWith('M')) return 'Moneypoint';
    if (code === 'T88') return 'Tarbert';

    console.warn('Unknown berth code:', berthCode);
    return null;
  }
}
