"""
Python-simulated lab devices that speak NETIO (IOU's Unix-dgram transport).

The image files in addons/iou are thin entry points into this package, since
the image list is the set of files in that directory:

  NETIO_VIRTUAL_PC            -> vpc_cli.main()        Virtual PC
  I86BI_LINUX-FAKE-M-*.py     -> fake_iou.main(...)    placeholder router
  I86BI_LINUX_L2-FAKE-M-*.py  -> fake_iou.main(...)    placeholder switch

Modules:
  netio      NETIO sockets, NETMAP, frame header (shared)
  packets    Ethernet/ARP/IPv4/ICMP/TCP/UDP builders
  tcp        client TCP connection
  dhcp       DHCP client
  apps       telnet / ssh / HTTP get / web server (VirtualPC mixin)
  vpc        VirtualPC: stack, ARP, ping, config, status
  console    Virtual PC line-editing console
  vpc_cli    Virtual PC commands and entry point
  fake_iou   placeholder router/switch
"""
