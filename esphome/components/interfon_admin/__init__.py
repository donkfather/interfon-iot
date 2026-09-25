"""interfon_admin: runtime settings (network, MQTT, notifications) + /admin/* HTTP API.

Settings live in two dedicated flash sectors (A/B), NOT in ESPHome's preferences area, so
they can never shift the stored history/counters and a power cut mid-save can't corrupt them.
The values below are only factory defaults, used when no settings have been saved yet.
"""
import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import time as time_
from esphome.const import CONF_ID, CONF_TIME_ID

DEPENDENCIES = ["wifi", "web_server_base", "network"]
AUTO_LOAD = ["web_server_base"]

interfon_admin_ns = cg.esphome_ns.namespace("interfon_admin")
InterfonAdmin = interfon_admin_ns.class_("InterfonAdmin", cg.Component)

CONF_DEFAULT_SSID = "default_ssid"
CONF_DEFAULT_PASSWORD = "default_password"
CONF_DEFAULT_STATIC_IP = "default_static_ip"
CONF_DEFAULT_GATEWAY = "default_gateway"
CONF_DEFAULT_SUBNET = "default_subnet"
CONF_DEFAULT_DNS1 = "default_dns1"
CONF_DEFAULT_DNS2 = "default_dns2"
CONF_DEFAULT_MQTT_PREFIX = "default_mqtt_prefix"
CONF_STORAGE_SECTOR = "storage_sector"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(InterfonAdmin),
        cv.Required(CONF_DEFAULT_SSID): cv.string,
        cv.Required(CONF_DEFAULT_PASSWORD): cv.string,
        cv.Optional(CONF_DEFAULT_STATIC_IP): cv.ipv4address,
        cv.Optional(CONF_DEFAULT_GATEWAY, default="192.168.1.1"): cv.ipv4address,
        cv.Optional(CONF_DEFAULT_SUBNET, default="255.255.255.0"): cv.ipv4address,
        cv.Optional(CONF_DEFAULT_DNS1, default="0.0.0.0"): cv.ipv4address,
        cv.Optional(CONF_DEFAULT_DNS2, default="0.0.0.0"): cv.ipv4address,
        cv.Optional(CONF_DEFAULT_MQTT_PREFIX, default="interfon"): cv.string,
        # 4 KB sectors. 0x200 = 2 MB: above the <=1 MB sketch, below the OTA staging area that
        # sits just under the ESPHome prefs sector near 4 MB (eagle.flash.4m.ld). Uses 0x200+0x201.
        cv.Optional(CONF_STORAGE_SECTOR, default=0x200): cv.int_range(min=0x110, max=0x2F0),
        cv.Optional(CONF_TIME_ID): cv.use_id(time_.RealTimeClock),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    sip = str(config[CONF_DEFAULT_STATIC_IP]) if CONF_DEFAULT_STATIC_IP in config else ""
    cg.add(
        var.set_defaults(
            config[CONF_DEFAULT_SSID],
            config[CONF_DEFAULT_PASSWORD],
            sip,
            str(config[CONF_DEFAULT_GATEWAY]),
            str(config[CONF_DEFAULT_SUBNET]),
            str(config[CONF_DEFAULT_DNS1]),
            str(config[CONF_DEFAULT_DNS2]),
            config[CONF_DEFAULT_MQTT_PREFIX],
        )
    )
    cg.add(var.set_storage_sector(config[CONF_STORAGE_SECTOR]))
    if CONF_TIME_ID in config:
        t = await cg.get_variable(config[CONF_TIME_ID])
        cg.add(var.set_time(t))
    cg.add_library("ESP8266HTTPClient", None)
