# Generated by Django 2.0.1 on 2018-01-29 15:17

from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='PaymentChannel',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('channel_id', models.CharField(db_index=True, max_length=128, unique=True)),
                ('from_address', models.CharField(db_index=True, max_length=64, unique=True)),
                ('committed_amount', models.PositiveIntegerField(default=0)),
                ('deposit_amount', models.PositiveIntegerField()),
                ('timeout', models.DateTimeField()),
                ('signature', models.CharField(max_length=256)),
            ],
        ),
    ]