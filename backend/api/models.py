from django.db import models


class PaymentChannel(models.Model):
    channel_id = models.CharField(max_length=128, unique=True, db_index=True)
    from_address = models.CharField(max_length=64, db_index=True)
    deposit_amount = models.PositiveIntegerField()
    committed_amount = models.PositiveIntegerField(default=0)
    used_amount = models.PositiveIntegerField(default=0)
    timeout = models.DateTimeField()
    signature = models.CharField(max_length=256, null=True)
    is_settled = models.BooleanField(default=False)
    is_timed_out = models.BooleanField(default=False)
    is_failed = models.BooleanField(default=False)



