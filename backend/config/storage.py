"""Options for the S3-compatible object storage (Supabase Storage) that holds issue photos in production.

Kept out of production.py so the tests can build the very same options and point them at a fake S3.
"""
from urllib.parse import urlsplit

IMMUTABLE_CACHE = "public, max-age=31536000, immutable"


def s3_storage_options(*, endpoint_url, region, access_key, secret_key, bucket, public_base_url):
    from botocore.config import Config

    public = urlsplit(public_base_url.rstrip("/"))
    return {
        "endpoint_url": endpoint_url,
        "region_name": region,
        "access_key": access_key,
        "secret_key": secret_key,
        "bucket_name": bucket,
        # Supabase serves a public bucket at <project>.supabase.co/storage/v1/object/public/<bucket>/<key>,
        # which is not the S3 endpoint, so URLs are built from the public base instead of being signed.
        "custom_domain": public.netloc + public.path,
        "url_protocol": f"{public.scheme}:",
        "querystring_auth": False,
        "default_acl": None,  # Supabase has no object ACLs; the bucket's own public/private setting rules
        "file_overwrite": False,
        "addressing_style": "path",
        "signature_version": "s3v4",
        # Object names are random uuids, so a stored photo never changes: cache it for a year.
        "object_parameters": {"CacheControl": IMMUTABLE_CACHE},
        # boto3 >= 1.36 adds checksum headers that some S3-compatible services reject.
        "client_config": Config(request_checksum_calculation="when_required", response_checksum_validation="when_required"),
    }
