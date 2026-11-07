# Test fixture maker: python3 scripts/make-encrypted-xls.py test/fixtures/imports/cams-feed.xls test/fixtures/imports
# (needs olefile and msoffcrypto-tool; msoffcrypto independently checks the files it writes).
"""Makes password-protected .xls test files (RC4 and RC4 CryptoAPI) from a plain one, and checks them with msoffcrypto."""
import io, os, struct, sys, hashlib
import olefile, msoffcrypto

src, outdir, password = sys.argv[1], sys.argv[2], "folio123"
wb = olefile.OleFileIO(src).openstream("Workbook").read()

def records(b):
    p = 0
    while p + 4 <= len(b):
        t, l = struct.unpack_from("<HH", b, p)
        yield p, t, b[p+4:p+4+l]
        p += 4 + l

def rc4(key, n):
    S = list(range(256)); j = 0
    for i in range(256):
        j = (j + S[i] + key[i % len(key)]) & 255; S[i], S[j] = S[j], S[i]
    i = j = 0; out = bytearray()
    for _ in range(n):
        i = (i + 1) & 255; j = (j + S[i]) & 255; S[i], S[j] = S[j], S[i]; out.append(S[(S[i] + S[j]) & 255])
    return bytes(out)

pw = password.encode("utf-16le")
salt = bytes(range(1, 17))
verifier = bytes(range(100, 116))

def make_rc4():
    h0 = hashlib.md5(pw).digest()[:5]
    h1 = hashlib.md5((h0 + salt) * 16).digest()[:5]
    mk = lambda blk: hashlib.md5(h1 + struct.pack("<I", blk)).digest()
    ks = rc4(mk(0), 32)
    enc = bytes(a ^ b for a, b in zip(verifier + hashlib.md5(verifier).digest(), ks))
    fp = struct.pack("<HHH", 1, 1, 1) + salt + enc
    return fp, mk

def make_cryptoapi():
    keybits = 128
    csp = "Microsoft Enhanced Cryptographic Provider v1.0\x00".encode("utf-16le")
    header = struct.pack("<IIIIIIII", 0x04, 0, 0x6801, 0x8004, keybits, 1, 0, 0) + csp
    h0 = hashlib.sha1(salt + pw).digest()
    mk = lambda blk: hashlib.sha1(h0 + struct.pack("<I", blk)).digest()[: keybits // 8]
    ks = rc4(mk(0), 36)
    enc = bytes(a ^ b for a, b in zip(verifier + hashlib.sha1(verifier).digest(), ks))
    fp = struct.pack("<HHH", 1, 4, 2) + struct.pack("<II", 0x04, len(header)) + header + struct.pack("<I", 16) + salt + enc[:16] + struct.pack("<I", 20) + enc[16:]
    return fp, mk

NEVER = {0x0809, 0x002F, 0x0194, 0x0195, 0x00E1, 0x0196, 0x0138}

def build(fp, mk):
    recs = list(records(wb))
    ins = 4 + len(fp)
    out = bytearray()
    for idx, (p, t, d) in enumerate(recs):
        if t == 0x0085:
            d = struct.pack("<I", struct.unpack_from("<I", d, 0)[0] + ins) + d[4:]
        out += struct.pack("<HH", t, len(d)) + d
        if idx == 0:
            out += struct.pack("<HH", 0x002F, len(fp)) + fp
    plain = bytes(out)
    ks = bytearray()
    blk = 0
    while len(ks) < len(plain):
        ks += rc4(mk(blk), 1024); blk += 1
    enc = bytearray(plain)
    for p, t, d in records(plain):
        if t in NEVER: continue
        start = p + 4 + (4 if t == 0x0085 else 0)
        for i in range(start, p + 4 + len(d)): enc[i] = plain[i] ^ ks[i]
    return plain, bytes(enc)

def cfb(stream):
    # Minimal compound file: 512-byte sectors, one "Workbook" stream (>= 4096 bytes, so no mini stream).
    SS = 512
    n_data = (len(stream) + SS - 1) // SS
    n_dir = 1
    total = n_data + n_dir
    n_fat = 1
    while n_fat * 128 < total + n_fat: n_fat += 1
    fat = [0xFFFFFFFF] * (n_fat * 128)
    for i in range(n_data): fat[i] = i + 1 if i < n_data - 1 else 0xFFFFFFFE
    fat[n_data] = 0xFFFFFFFE  # directory
    for k in range(n_fat): fat[n_data + n_dir + k] = 0xFFFFFFFD
    def entry(name, typ, start, size, child=0xFFFFFFFF):
        nm = (name + "\x00").encode("utf-16le")
        e = nm.ljust(64, b"\x00") + struct.pack("<HBB", len(nm), typ, 1) + struct.pack("<III", 0xFFFFFFFF, 0xFFFFFFFF, child)
        e += b"\x00" * 16 + b"\x00" * 4 + b"\x00" * 16 + struct.pack("<II", start, size) + b"\x00" * 4
        return e
    dirsec = entry("Root Entry", 5, 0xFFFFFFFE, 0, child=1) + entry("Workbook", 2, 0, len(stream))
    dirsec = dirsec.ljust(SS, b"\x00")
    for i in range(2, 4): pass
    # Unused directory slots: mark as empty (all zero is fine except type 0).
    hdr = bytearray(512)
    hdr[0:8] = bytes.fromhex("D0CF11E0A1B11AE1")
    struct.pack_into("<HHHH", hdr, 24, 0x3E, 3, 0xFFFE, 9)
    struct.pack_into("<H", hdr, 32, 6)
    struct.pack_into("<I", hdr, 44, n_fat)
    struct.pack_into("<I", hdr, 48, n_data)
    struct.pack_into("<I", hdr, 56, 4096)
    struct.pack_into("<IIII", hdr, 60, 0xFFFFFFFE, 0, 0xFFFFFFFE, 0)
    for i in range(109): struct.pack_into("<I", hdr, 76 + i * 4, n_data + n_dir + i if i < n_fat else 0xFFFFFFFF)
    body = stream.ljust(n_data * SS, b"\x00") + dirsec + b"".join(struct.pack("<I", x) for x in fat)
    return bytes(hdr) + body

for name, maker in (("rc4", make_rc4), ("cryptoapi", make_cryptoapi)):
    fp, mk = maker()
    plain, enc = build(fp, mk)
    data = cfb(enc)
    path = os.path.join(outdir, f"cams-feed-{name}.xls")
    open(path, "wb").write(data)
    # Independent check: msoffcrypto verifies the password and decrypts to our plain stream.
    f = msoffcrypto.OfficeFile(io.BytesIO(data)); f.load_key(password=password)
    out = io.BytesIO(); f.decrypt(out)
    dec = olefile.OleFileIO(io.BytesIO(out.getvalue())).openstream("Workbook").read()
    fp_start = 4 + len(list(records(plain))[0][2])
    expected = plain[:fp_start] + b"\x00\x00" + struct.pack("<H", len(fp)) + b"\x00" * len(fp) + plain[fp_start + 4 + len(fp):]
    if dec[:len(expected)] != expected:
        i = next(k for k in range(len(expected)) if dec[k] != expected[k]); print("first diff at", i, dec[i:i+8].hex(), expected[i:i+8].hex())
    print(name, "msoffcrypto decrypts to our stream:", dec[:len(expected)] == expected, len(data), "bytes")
