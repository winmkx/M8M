/*
 * Copyright (C) 2014 Massimo Del Zotto
 * This code is released under the MIT license.
 * For conditions of distribution and use, see the LICENSE or hit the web.
 */
void AESRoundLDS(local uint *o0, local uint *o1, local uint *o2, local uint *o3, uint k0, uint k1, uint k2, uint k3,
                 local uint *lut0, local uint *lut1, local uint *lut2, local uint *lut3) {
#if __ENDIAN_LITTLE__
#define LUT(li, val)  (lut##li != 0? lut##li[(val >> (8 * li)) & 0xFF] : rotate(lut0[(val >> (8 * li)) & 0xFF], (8u * li##u)))

    uint i0 = *o0;
    uint i1 = *o1;
    uint i2 = *o2;
    uint i3 = *o3;
    *o0 = lut0[i0 & 0xFF] ^ LUT(1, i1) ^ LUT(2, i2) ^ LUT(3, i3) ^ k0;
    *o1 = lut0[i1 & 0xFF] ^ LUT(1, i2) ^ LUT(2, i3) ^ LUT(3, i0) ^ k1;
    *o2 = lut0[i2 & 0xFF] ^ LUT(1, i3) ^ LUT(2, i0) ^ LUT(3, i1) ^ k2;
    *o3 = lut0[i3 & 0xFF] ^ LUT(1, i0) ^ LUT(2, i1) ^ LUT(3, i2) ^ k3;

#undef LUT
#else
#error Endianness?
#endif
}


void AESRoundNoKeyLDS(local uint *o0, local uint *o1, local uint *o2, local uint *o3,
                   local uint *lut0, local uint *lut1, local uint *lut2, local uint *lut3) {
    AESRoundLDS(o0, o1, o2, o3, 0, 0, 0, 0, lut0, lut1, lut2, lut3);
}

/* stop of repeated code, below is echo specific */


void Increment(uint4 *modify, uint add) {
    uint4 inc = *modify;
    inc.x += add;
    if(inc.x < (*modify).x) { // wrapped
        inc.y++;
        if(inc.y == 0) {
            inc.z++;
            if(inc.z == 0) inc.w++;
        }
    }
    *modify = inc;
}


uint2 hilo(uint2 val) {
#if __ENDIAN_LITTLE__
    return val.yx;
#else
#error Endianness?
#endif
}


uint2 Echo_RoundMangle(uint2 vec) {
    ulong big = (convert_ulong(vec.x) << 32) | vec.y;
    const ulong a = (big & 0x8080808080808080ul) >> 7u;
    const ulong b = (big & 0x7F7F7F7F7F7F7F7Ful) << 1u;
    big = (a * 27u) ^ b;
    return (uint2)(convert_uint(big >> 32), convert_uint(big));
}


uint Wrap(uint offset) {
    uint displaced = offset + (get_local_id(0) % 4);
    displaced %= 4;
    if(offset % 2) displaced += (get_local_id(0) < 4? 4 : -4);
    displaced += offset * 64; // offset is also row index
    return displaced;
}


#if defined ECHO_IS_LAST
__attribute__((reqd_work_group_size(8, 8, 1)))
kernel void Echo_8way(global uint2 *input, volatile global uint *found, global uint *dispatchData, global uint *aes_round_luts) {
#else
__attribute__((reqd_work_group_size(8, 8, 1)))
kernel void Echo_8way(global uint2 *input, global uint2 *hashOut, global uint *aes_round_luts, global uint *debug) {
#endif
    input += (get_global_id(1) - get_global_offset(1)) * 8;
    local uint aesLUT0[256];
    event_t ldsReady = async_work_group_copy(aesLUT0, aes_round_luts + 256 * 0, 256, 0);
#if defined AES_TABLE_ROW_1
    local uint aesLUT1[256];
    async_work_group_copy(aesLUT1, aes_round_luts + 256 * 1, 256, ldsReady);
#else
    local uint *aesLUT1 = 0;
#endif
#if defined AES_TABLE_ROW_2
    local uint aesLUT2[256];
    async_work_group_copy(aesLUT2, aes_round_luts + 256 * 2, 256, ldsReady);
#else
    local uint *aesLUT2 = 0;
#endif
#if defined AES_TABLE_ROW_3
    local uint aesLUT3[256];
    async_work_group_copy(aesLUT3, aes_round_luts + 256 * 3, 256, ldsReady);
#else
    local uint *aesLUT3 = 0;
#endif

    /* Legacy 1-way kernels here have a boatload of registers here. Think at them as
        ulong W[16][2], Vb[8][2];
    If you look carefully, you'll see Vb is constants.
    As for W, each thread here works "on a column", so across the work items registers are
    WI0 using 00, 10, 20, 30        WI [4-7] use 01,11,21,31 instead.
      1       40  50  60  70
      2       80  90  A0  B0
      3       C0  D0  E0  F0
    This allows to keep the MIX_COLUMN operation inside a single WI, which is good for perf
    because it would require re-sync before next iteration.
    Those registers are workN, the other index is 0 if localindex(0)<4, otherwise 1. */
    uint2 work0, work1, work2, work3;
    uint4 notSoK = (uint4)(512, 0, 0, 0);
    notSoK.x += (get_local_id(0) % 4) * 4 + (get_local_id(0) < 4? 0 : 1);

    switch(get_local_id(0)) {
    case 0:
    case 1:
        work0 = work1 = work2 = work3 = (uint2)(0, 512);
        break;
    case 3:
    case 7:
        work0 = get_local_id(0) < 4? (uint2)(0, 0x80)   : (uint2)(0);
        work1 = get_local_id(0) < 4? (uint2)(0)         : (uint2)(0);
        work2 = get_local_id(0) < 4? (uint2)(0)         : (uint2)(0x02000000, 0);
        work3 = get_local_id(0) < 4? (uint2)(0, 0x0200) : (uint2)(0);
        break;
    case 4:
    case 5:
        work0 = work1 = work2 = work3 = (uint2)(0);
        break;
    case 2:
    case 6:
        work0 = hilo(input[0 + (get_local_id(0) < 4? 0 : 1)]);
        work1 = hilo(input[2 + (get_local_id(0) < 4? 0 : 1)]);
        work2 = hilo(input[4 + (get_local_id(0) < 4? 0 : 1)]);
        work3 = hilo(input[6 + (get_local_id(0) < 4? 0 : 1)]);
        break;
    }

    wait_group_events(1, &ldsReady); // this is really necessary only a few lines below but here is nicer for structure
    local uint passhi[4 * 8 * 8];
    local uint passlo[4 * 8 * 8];

    uint evnSlot = get_local_id(0) + get_local_id(1) * 8;
    uint oddSlot = get_local_id(0) + get_local_id(1) * 8 + (get_local_id(0) < 4? 4 : -4);
    passhi[64 * 0 + evnSlot] = work0.hi;    passlo[64 * 0 + evnSlot] = work0.lo;
    passhi[64 * 1 + oddSlot] = work1.hi;    passlo[64 * 1 + oddSlot] = work1.lo;
    passhi[64 * 2 + evnSlot] = work2.hi;    passlo[64 * 2 + evnSlot] = work2.lo;
    passhi[64 * 3 + oddSlot] = work3.hi;    passlo[64 * 3 + oddSlot] = work3.lo;

    for (unsigned u = 0; u < 10; u ++) {
        { /* Legacy kernel performs 16 passes of two AES rounds on the various registers. WorkNo, WorkNi.
            I do that explicitly as I already "unrolled" those 16 passes across 8 WI. Note I need to increment
            the K values differently. */
            uint slot = get_local_id(1) * 8; // location of W00 for this group of 8 threads
            slot += get_local_id(0) % 4; // selected a column
            slot += get_local_id(0) < 4? 0 : 64; // go down a line skipping values not yours
            const int toi = get_local_id(0) < 4? 4 : 0;
            const int too = get_local_id(0) < 4? 0 : 4;
            {
                local uint *x0 = passhi + slot + too, *x1 = passlo + slot + too;
                local uint *x2 = passhi + slot + toi, *x3 = passlo + slot + toi;
                barrier(CLK_LOCAL_MEM_FENCE);
                AESRoundLDS(x0, x1, x2, x3, notSoK.x, notSoK.y, notSoK.z, notSoK.w, aesLUT0, aesLUT1, aesLUT2, aesLUT3);
                barrier(CLK_LOCAL_MEM_FENCE);
                AESRoundNoKeyLDS(x0, x1, x2, x3, aesLUT0, aesLUT1, aesLUT2, aesLUT3);
                Increment(&notSoK, 2);
            }
            slot += 8 * 8 * 2;
            {
                local uint *x0 = passhi + slot + too, *x1 = passlo + slot + too;
                local uint *x2 = passhi + slot + toi, *x3 = passlo + slot + toi;
                barrier(CLK_LOCAL_MEM_FENCE);
                AESRoundLDS(x0, x1, x2, x3, notSoK.x, notSoK.y, notSoK.z, notSoK.w, aesLUT0, aesLUT1, aesLUT2, aesLUT3);
                barrier(CLK_LOCAL_MEM_FENCE);
                AESRoundNoKeyLDS(x0, x1, x2, x3, aesLUT0, aesLUT1, aesLUT2, aesLUT3);
                Increment(&notSoK, 16 - 2);
            }
        }
        /* I somehow managed to write shift-rows merged with mix-column... but it was fairly complicated
        and it broke (I'm surprised it worked). It's just better to go with something easier and do it as standard.
        Instead of rotating the rows, I just fetch the values to registers and be done with it. */
        {
            barrier(CLK_LOCAL_MEM_FENCE);
            local uint *halfhi = passhi + (get_local_id(0) < 4? 0 : 4) + get_local_id(1) * 8;
            local uint *halflo = passlo + (get_local_id(0) < 4? 0 : 4) + get_local_id(1) * 8;
            work0.hi = halfhi[Wrap(0)];    work0.lo = halflo[Wrap(0)];
            work1.hi = halfhi[Wrap(1)];    work1.lo = halflo[Wrap(1)];
            work2.hi = halfhi[Wrap(2)];    work2.lo = halflo[Wrap(2)];
            work3.hi = halfhi[Wrap(3)];    work3.lo = halflo[Wrap(3)];
        }
        { // MIX_COLUMN by registers is super easy, now almost identical to SPH
            uint2 a = work0, b = work1, c = work2, d = work3; // I got plenty registers anyway!
            uint2 ab = a ^ b;
            uint2 bc = b ^ c;
            uint2 cd = c ^ d;
            uint2 abx = Echo_RoundMangle(ab);
            uint2 bcx = Echo_RoundMangle(bc);
            uint2 cdx = Echo_RoundMangle(cd);
            work0 = abx ^ bc ^ d;
            work1 = bcx ^ a ^ cd;
            work2 = cdx ^ ab ^ d;
            work3 = abx ^ bcx ^ cdx ^ ab ^ c;
        }
        passhi[64 * 0 + evnSlot] = work0.hi;    passlo[64 * 0 + evnSlot] = work0.lo;
        passhi[64 * 1 + oddSlot] = work1.hi;    passlo[64 * 1 + oddSlot] = work1.lo;
        passhi[64 * 2 + evnSlot] = work2.hi;    passlo[64 * 2 + evnSlot] = work2.lo;
        passhi[64 * 3 + oddSlot] = work3.hi;    passlo[64 * 3 + oddSlot] = work3.lo;
    }
    barrier(CLK_LOCAL_MEM_FENCE);
    // End, some bank collisions here but not much of a problem.
    const uint row = get_local_id(0) / 2; // 00,01,10,11,20,21,30,31 ^ 80,81,90,91,A0,A1,B0,B1
    const int rowbeg = get_local_id(1) * 8 + row * 64;
    int no = rowbeg + ((row + get_local_id(0)) % 2 == 0? 0 : 4);
    int ni = no + 2;
    const uint2 noval = (uint2)(passhi[no], passlo[no]);
    const uint2 nival = (uint2)(passhi[ni], passlo[ni]);
    const uint2 xorv = get_local_id(0) % 2 == 0? (uint2)(512, 0) : (uint2)(0);
    const uint2 myHash = xorv ^ input[get_local_id(0)] ^ noval ^ nival;

#if defined ECHO_IS_LAST
    barrier(CLK_LOCAL_MEM_FENCE);
    if(get_local_id(0) == 3) {
        ulong magic = upsample(myHash.y, myHash.x);
        ulong target =  upsample(dispatchData[1], dispatchData[2]); // watch out for endianess!
		passhi[get_local_id(1)] = magic <= target;
        if(magic <= target) {
            uint storage = atomic_inc(found);
			passhi[get_local_size(1) + get_local_id(1)] = storage;
			// Now passing out the whole hash as well as nonce for extra checking
            const uint nonce = (uint)(get_global_id(1));
            found[storage * 17 + 1] = as_uint(as_char4(nonce).wzyx); // watch out for endianess!
        }
    }
	barrier(CLK_LOCAL_MEM_FENCE);
	uint candidate = 0;
	for(uint slot = 0; slot < get_local_size(1); slot++) candidate = slot == get_local_id(1)? passhi[slot] : candidate;
	if(candidate) {
	    found++;
        candidate = passhi[get_local_size(1) + get_local_id(1)]; // very **likely** broadcast
		found += candidate * 17;
        found++; // this one is the nonce, already stored
        found[get_local_id(0) * 2 + 0] = myHash.x;
        found[get_local_id(0) * 2 + 1] = myHash.y;
	}
#else
#error to be tested!
    hashOut += (get_global_id(1) - get_global_offset(1)) * 8;
    hashOut[get_local_id(0)] = myHash; // maybe swap uints
#endif
}
