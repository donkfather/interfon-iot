"""Print the D1 mini's serial output: .venv/bin/python serial_monitor.py [seconds] [--no-reset]
Without --no-reset it pulses RTS to reset the board first."""
import serial, sys, time
port = '/dev/cu.usbserial-10'
secs = float(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 30
baud = int(sys.argv[sys.argv.index("--baud")+1]) if "--baud" in sys.argv else 115200
s = serial.Serial(port, baud, timeout=0.2)
if '--no-reset' not in sys.argv:
    s.dtr = False; s.rts = False; time.sleep(0.2)
    s.rts = True; time.sleep(0.3); s.rts = False
t0 = time.time(); chunks = []
while time.time() - t0 < secs:
    chunks.append(s.read(4096))
s.close(); buf = b''.join(chunks)
sys.stderr.write(f"[{len(buf)} bytes in {secs:.0f}s]\n")
print(buf.decode('utf-8', 'replace'))
