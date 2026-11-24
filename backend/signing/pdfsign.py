"""PDF signing for VanaDash, called by shared/lib/pdf-signing.ts with execFile.

  gen-cert --cn NAME                      -> {"certPem", "keyPem"} on stdout (P-256, self-signed, 5 years)
  fill IN OUT --role R --cert C --key K --name N --image PNG
                                          -> signs every empty field of the role, each as its own
                                             incremental revision; {"fields": [...]} on stdout
  inspect IN                              -> {"signatures": [{field, signerName, signingTime, intact, valid,
                                              modificationLevel, coversWholeDocument}], "emptyFields": [...]}
  check-append OLD NEW                    -> exit 0 when NEW is OLD plus at least one intact signature

Exit codes: 2 = the input breaks a rule (no field to fill, not an append), 1 = anything else.
"""
import argparse
import datetime
import io
import json
import logging
import re
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from PIL import Image
from pyhanko import stamp
from pyhanko.pdf_utils import images
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign import fields, signers
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext

MAX_IMAGE_PIXELS = 2000 * 1000
ALLOWED_AFTER_SIGNING = ('NONE', 'FORM_FILLING', 'LTA_UPDATES')
# pyHanko logs a traceback for every self-signed certificate it validates; stdout carries the answer.
logging.disable(logging.CRITICAL)


class RuleBroken(Exception):
    pass


def gen_cert(cn):
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=5 * 365))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(digital_signature=True, content_commitment=True, key_encipherment=False, data_encipherment=False,
                          key_agreement=False, key_cert_sign=False, crl_sign=False, encipher_only=False, decipher_only=False),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )
    print(json.dumps({
        'certPem': cert.public_bytes(serialization.Encoding.PEM).decode(),
        'keyPem': key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode(),
    }))


def empty_fields_of(data, role):
    pattern = re.compile(r'^Semnatura_' + re.escape(role) + r'(_\d+)?$', re.IGNORECASE)
    reader = PdfFileReader(io.BytesIO(data))
    names = []
    for name, value, _ref in fields.enumerate_sig_fields(reader, filled_status=False):
        if pattern.match(name):
            names.append(name)
    return names


def fill(src, dst, role, cert, key, name, image):
    data = open(src, 'rb').read()
    targets = empty_fields_of(data, role)
    if not targets:
        raise RuleBroken('no empty signature field for role ' + role)
    try:
        with Image.open(image) as img:
            img.verify()
            if img.format != 'PNG' or img.width * img.height > MAX_IMAGE_PIXELS:
                raise RuleBroken('signature image must be a PNG of at most 2 megapixels')
    except (OSError, SyntaxError, ValueError) as err:
        raise RuleBroken('signature image is not a readable PNG') from err
    signer = signers.SimpleSigner.load(key, cert)
    # The drawn signature only: the name and time are in the signature itself and on the certificate page.
    style = stamp.TextStampStyle(stamp_text='', background=images.PdfImage(image), border_width=0)
    current = data
    for field in targets:
        writer = IncrementalPdfFileWriter(io.BytesIO(current))
        meta = signers.PdfSignatureMetadata(field_name=field, name=name, reason='Semnat prin VanaDash')
        out = io.BytesIO()
        signers.PdfSigner(meta, signer=signer, stamp_style=style).sign_pdf(writer, output=out)
        signed = out.getvalue()
        if not signed.startswith(current):
            raise RuleBroken('the signature rewrote the file instead of appending')
        current = signed
    open(dst, 'wb').write(current)
    print(json.dumps({'fields': targets}))


def describe(data):
    reader = PdfFileReader(io.BytesIO(data))
    result = []
    for sig in reader.embedded_signatures:
        # No trust roots: a qualified certificate is checked against the EU lists elsewhere (Adobe, pdfsig).
        # Here "valid" means the cryptography holds; "intact" that the signed bytes were not changed.
        status = validate_pdf_signature(sig, ValidationContext(allow_fetching=False))
        signer = sig.signer_cert.subject.native.get('common_name') if sig.signer_cert else None
        signing_time = sig.self_reported_timestamp.isoformat() if sig.self_reported_timestamp else None
        result.append({
            'field': sig.field_name,
            'signerName': signer,
            'signingTime': signing_time,
            'intact': bool(status.intact),
            'valid': bool(status.intact and status.valid),
            'modificationLevel': status.modification_level.name if status.modification_level else None,
            'coversWholeDocument': status.coverage.name == 'ENTIRE_FILE' if status.coverage else False,
        })
    return result


def check_append(old_path, new_path):
    old = open(old_path, 'rb').read()
    new = open(new_path, 'rb').read()
    if not new.startswith(old) or len(new) == len(old):
        raise RuleBroken('the new file does not start with the old one')
    before = describe(old)
    after = describe(new)
    if len(after) <= len(before) or not all(s['intact'] for s in after):
        raise RuleBroken('no new intact signature, or an older one broke')
    # Filling a field and signing are allowed after a signature; adding fields or changing pages is not.
    if any(s['modificationLevel'] not in ALLOWED_AFTER_SIGNING for s in after):
        raise RuleBroken('the file was changed beyond filling in signature fields')
    print(json.dumps(after))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    g = sub.add_parser('gen-cert'); g.add_argument('--cn', required=True)
    f = sub.add_parser('fill')
    f.add_argument('src'); f.add_argument('dst')
    for opt in ('--role', '--cert', '--key', '--name', '--image'):
        f.add_argument(opt, required=True)
    i = sub.add_parser('inspect'); i.add_argument('src')
    c = sub.add_parser('check-append'); c.add_argument('old'); c.add_argument('new')
    args = parser.parse_args()
    try:
        if args.command == 'gen-cert':
            gen_cert(args.cn)
        elif args.command == 'fill':
            fill(args.src, args.dst, args.role, args.cert, args.key, args.name, args.image)
        elif args.command == 'inspect':
            data = open(args.src, 'rb').read()
            empty = [name for name, _v, _r in fields.enumerate_sig_fields(PdfFileReader(io.BytesIO(data)), filled_status=False)]
            print(json.dumps({'signatures': describe(data), 'emptyFields': empty}))
        else:
            check_append(args.old, args.new)
    except RuleBroken as err:
        print(str(err), file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    main()
