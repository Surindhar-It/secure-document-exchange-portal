/**
 * Image Steganography Module for Secure Document Exchange Portal (SecureDocX)
 * Implements standard Least Significant Bit (LSB) embedding and extraction across RGB channels.
 * Note: Alpha channel is preserved to maintain visual integrity and image rendering.
 */

// Magic 4-byte marker: "STGX" in ASCII (0x53, 0x54, 0x47, 0x58)
const MAGIC_HEADER = [0x53, 0x54, 0x47, 0x58];
const HEADER_SIZE_BYTES = 4; // Magic
const LENGTH_FIELD_BYTES = 4; // Payload length (32-bit unsigned uint)
const CHECKSUM_FIELD_BYTES = 4; // Simple Adler-32 / CRC checksum
const PROTOCOL_OVERHEAD = HEADER_SIZE_BYTES + LENGTH_FIELD_BYTES + CHECKSUM_FIELD_BYTES; // 12 bytes

/**
 * Compute 32-bit checksum for payload verification
 */
function computeChecksum(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Calculates max payload capacity (in bytes) that can be embedded in an image of given dimensions
 */
export function calculateImageCapacity(width: number, height: number): number {
  const totalPixels = width * height;
  const totalBits = totalPixels * 3; // 3 bits per pixel (R, G, B)
  const totalBytes = Math.floor(totalBits / 8);
  const usableBytes = totalBytes - PROTOCOL_OVERHEAD;
  return usableBytes > 0 ? usableBytes : 0;
}

export interface EmbedResult {
  success: boolean;
  bytesEmbedded?: number;
  capacity?: number;
  error?: string;
}

export interface ExtractResult {
  success: boolean;
  payload?: string;
  error?: string;
}

/**
 * Embeds a text/JSON payload into pixel data (RGBA array) using LSB encoding.
 * Modifies the provided pixelArray in-place.
 */
export function embedPayloadInImageData(
  pixelArray: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  payloadText: string
): EmbedResult {
  try {
    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(payloadText);

    const capacity = calculateImageCapacity(width, height);
    if (payloadBytes.length > capacity) {
      return {
        success: false,
        capacity,
        error: `Payload too large (${payloadBytes.length} bytes). Image capacity is ${capacity} bytes. Use a higher resolution image (min ${Math.ceil(
          Math.sqrt(((payloadBytes.length + PROTOCOL_OVERHEAD) * 8) / 3)
        )}x${Math.ceil(
          Math.sqrt(((payloadBytes.length + PROTOCOL_OVERHEAD) * 8) / 3)
        )} px).`,
      };
    }

    const checksum = computeChecksum(payloadBytes);

    // Build byte packet: [MAGIC: 4 bytes][LENGTH: 4 bytes big-endian][PAYLOAD: N bytes][CHECKSUM: 4 bytes big-endian]
    const packet = new Uint8Array(PROTOCOL_OVERHEAD + payloadBytes.length);
    packet.set(MAGIC_HEADER, 0);

    const dataView = new DataView(packet.buffer);
    dataView.setUint32(HEADER_SIZE_BYTES, payloadBytes.length, false); // Big-endian length
    packet.set(payloadBytes, HEADER_SIZE_BYTES + LENGTH_FIELD_BYTES);
    dataView.setUint32(HEADER_SIZE_BYTES + LENGTH_FIELD_BYTES + payloadBytes.length, checksum, false);

    // Convert packet bytes into a bitstream
    const bitStream: number[] = [];
    for (let i = 0; i < packet.length; i++) {
      const byte = packet[i];
      for (let bitIndex = 7; bitIndex >= 0; bitIndex--) {
        bitStream.push((byte >> bitIndex) & 1);
      }
    }

    // Embed bits into RGB channels of pixelArray (stride of 4: R, G, B, A)
    let bitPointer = 0;
    const totalPixels = width * height;

    for (let p = 0; p < totalPixels && bitPointer < bitStream.length; p++) {
      const pixelOffset = p * 4;

      // Channel 0: Red
      if (bitPointer < bitStream.length) {
        pixelArray[pixelOffset] = (pixelArray[pixelOffset] & 0xfe) | bitStream[bitPointer++];
      }
      // Channel 1: Green
      if (bitPointer < bitStream.length) {
        pixelArray[pixelOffset + 1] = (pixelArray[pixelOffset + 1] & 0xfe) | bitStream[bitPointer++];
      }
      // Channel 2: Blue
      if (bitPointer < bitStream.length) {
        pixelArray[pixelOffset + 2] = (pixelArray[pixelOffset + 2] & 0xfe) | bitStream[bitPointer++];
      }
      // Channel 3: Alpha is left untouched!
    }

    return {
      success: true,
      bytesEmbedded: payloadBytes.length,
      capacity,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Steganography embedding failed: ${msg}`,
    };
  }
}

/**
 * Extracts embedded payload from pixel data (RGBA array) using LSB decoding.
 */
export function extractPayloadFromImageData(
  pixelArray: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): ExtractResult {
  try {
    const totalPixels = width * height;
    const totalUsableBits = totalPixels * 3;
    const totalUsableBytes = Math.floor(totalUsableBits / 8);

    if (totalUsableBytes < PROTOCOL_OVERHEAD) {
      return { success: false, error: "Image dimensions too small to contain valid steganographic header" };
    }

    // Extract first 12 bytes (96 bits) to inspect header and payload length
    const initialBits: number[] = [];
    let p = 0;
    while (p < totalPixels && initialBits.length < PROTOCOL_OVERHEAD * 8) {
      const pixelOffset = p * 4;
      initialBits.push(pixelArray[pixelOffset] & 1); // R
      if (initialBits.length < PROTOCOL_OVERHEAD * 8) initialBits.push(pixelArray[pixelOffset + 1] & 1); // G
      if (initialBits.length < PROTOCOL_OVERHEAD * 8) initialBits.push(pixelArray[pixelOffset + 2] & 1); // B
      p++;
    }

    const headerBytes = new Uint8Array(PROTOCOL_OVERHEAD);
    for (let b = 0; b < PROTOCOL_OVERHEAD; b++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        byteVal = (byteVal << 1) | initialBits[b * 8 + bit];
      }
      headerBytes[b] = byteVal;
    }

    // Verify magic header: STGX
    for (let i = 0; i < 4; i++) {
      if (headerBytes[i] !== MAGIC_HEADER[i]) {
        return {
          success: false,
          error: "No steganographic payload detected or image has been compressed/modified.",
        };
      }
    }

    // Read payload length
    const dataView = new DataView(headerBytes.buffer);
    const payloadLength = dataView.getUint32(HEADER_SIZE_BYTES, false);

    const maxAllowed = totalUsableBytes - PROTOCOL_OVERHEAD;
    if (payloadLength <= 0 || payloadLength > maxAllowed) {
      return {
        success: false,
        error: `Invalid embedded payload length (${payloadLength} bytes). Corrupted or non-stego image.`,
      };
    }

    const totalPacketBytes = PROTOCOL_OVERHEAD + payloadLength;
    const totalRequiredBits = totalPacketBytes * 8;

    // Extract all bits
    const allBits: number[] = [];
    p = 0;
    while (p < totalPixels && allBits.length < totalRequiredBits) {
      const pixelOffset = p * 4;
      allBits.push(pixelArray[pixelOffset] & 1);
      if (allBits.length < totalRequiredBits) allBits.push(pixelArray[pixelOffset + 1] & 1);
      if (allBits.length < totalRequiredBits) allBits.push(pixelArray[pixelOffset + 2] & 1);
      p++;
    }

    if (allBits.length < totalRequiredBits) {
      return { success: false, error: "Image terminated prematurely before full payload could be extracted." };
    }

    // Convert bits to full packet bytes
    const fullPacket = new Uint8Array(totalPacketBytes);
    for (let b = 0; b < totalPacketBytes; b++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        byteVal = (byteVal << 1) | allBits[b * 8 + bit];
      }
      fullPacket[b] = byteVal;
    }

    const payloadBytes = fullPacket.slice(
      HEADER_SIZE_BYTES + LENGTH_FIELD_BYTES,
      HEADER_SIZE_BYTES + LENGTH_FIELD_BYTES + payloadLength
    );

    const packetView = new DataView(fullPacket.buffer);
    const storedChecksum = packetView.getUint32(HEADER_SIZE_BYTES + LENGTH_FIELD_BYTES + payloadLength, false);
    const computedChecksum = computeChecksum(payloadBytes);

    if (storedChecksum !== computedChecksum) {
      return {
        success: false,
        error: "Steganography checksum mismatch! Payload data has been corrupted or degraded by image alteration.",
      };
    }

    const decoder = new TextDecoder();
    const payloadText = decoder.decode(payloadBytes);

    return {
      success: true,
      payload: payloadText,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Steganography extraction error: ${msg}`,
    };
  }
}
