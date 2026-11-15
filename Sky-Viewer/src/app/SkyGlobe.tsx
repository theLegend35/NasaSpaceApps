"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type SkyGlobeProps = {
  ra: number;
  dec: number;
  zoom: number;
  footprints: number[][][];
  onPick: (ra: number, dec: number) => void;
};

type SkyMapProps = {
  ra: number;
  dec: number;
  footprints: number[][][];
  onPick: (ra: number, dec: number) => void;
};

const mapStars = Array.from({ length: 420 }, (_, index) => {
  const fraction = (value: number) => value - Math.floor(value);
  return {
    x: fraction(Math.sin(index * 127.1) * 43758.5453),
    y: fraction(Math.sin(index * 311.7) * 24634.6345),
    size: index % 19 === 0 ? 2.4 : index % 5 === 0 ? 1.6 : 1,
    opacity: 0.24 + fraction(Math.sin(index * 17.31) * 15.7) * 0.65,
  };
});

function skyVector(ra: number, dec: number, radius: number) {
  const longitude = THREE.MathUtils.degToRad(ra);
  const latitude = THREE.MathUtils.degToRad(dec);
  return new THREE.Vector3(
    radius * Math.cos(latitude) * Math.sin(longitude),
    radius * Math.sin(latitude),
    radius * Math.cos(latitude) * Math.cos(longitude),
  );
}

function interpolateSphere(start: THREE.Vector3, end: THREE.Vector3, amount: number) {
  const angle = Math.acos(THREE.MathUtils.clamp(start.dot(end), -1, 1));
  if (angle < 1e-6) return start.clone();
  const divisor = Math.sin(angle);
  return start.clone()
    .multiplyScalar(Math.sin((1 - amount) * angle) / divisor)
    .addScaledVector(end, Math.sin(amount * angle) / divisor)
    .normalize();
}

export function SkyMap({ ra, dec, footprints, onPick }: SkyMapProps) {
  function pickPosition(event: React.MouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = THREE.MathUtils.clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const y = THREE.MathUtils.clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    onPick(x * 360, 90 - y * 180);
  }

  return (
    <div
      className="sky-map"
      role="application"
      aria-label="Interactive all-sky map. Click to set the selected coordinate."
      tabIndex={0}
      onClick={pickPosition}
    >
      <div className="map-graticule" />
      <svg className="footprint-layer" viewBox="0 0 360 180" preserveAspectRatio="none" aria-hidden="true">
        {footprints.map((polygon, index) => (
          <polygon key={index} points={polygon.map(([longitude, latitude]) => `${longitude},${90 - latitude}`).join(" ")} />
        ))}
      </svg>
      {mapStars.map((star, index) => (
        <span
          className="map-star"
          key={index}
          style={{
            left: `${star.x * 100}%`,
            top: `${star.y * 100}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            opacity: star.opacity,
          }}
        />
      ))}
      <span className="map-ra-label map-ra-left">0°</span>
      <span className="map-ra-label map-ra-right">360°</span>
      <span className="map-dec-label map-dec-top">+90°</span>
      <span className="map-dec-label map-dec-bottom">−90°</span>
      <span
        className="map-selected-point"
        style={{ left: `${(ra / 360) * 100}%`, top: `${((90 - dec) / 180) * 100}%` }}
      />
    </div>
  );
}

export default function SkyGlobe({ ra, dec, zoom, footprints, onPick }: SkyGlobeProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const globeRef = useRef<THREE.Group | null>(null);
  const footprintGroupRef = useRef<THREE.Group | null>(null);
  const zoomRef = useRef(zoom);
  const onPickRef = useRef(onPick);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      setUnavailable(true);
      return;
    }

    setUnavailable(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "globe-canvas";
    renderer.domElement.setAttribute("aria-label", "Three-dimensional star globe");
    renderer.domElement.style.touchAction = "none";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
    camera.position.set(0, 0, 4.35);
    cameraRef.current = camera;

    const globe = new THREE.Group();
    globe.position.y = -0.08;
    globeRef.current = globe;
    globe.quaternion.setFromUnitVectors(
      skyVector(ra, dec, 1).normalize(),
      new THREE.Vector3(0, 0, 1),
    );
    scene.add(globe);

    const footprintGroup = new THREE.Group();
    footprintGroupRef.current = footprintGroup;
    globe.add(footprintGroup);

    const radius = 1.62;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 72, 56),
      new THREE.MeshBasicMaterial({ color: "#1c1c38" }),
    );
    globe.add(sphere);

    const gridMaterial = new THREE.LineBasicMaterial({
      color: "#837ac5",
      transparent: true,
      opacity: 0.3,
    });

    for (const latitude of [-60, -30, 0, 30, 60]) {
      const points: THREE.Vector3[] = [];
      const angle = THREE.MathUtils.degToRad(latitude);
      for (let step = 0; step < 100; step++) {
        const longitude = (step / 100) * Math.PI * 2;
        points.push(new THREE.Vector3(
          1.626 * Math.cos(angle) * Math.sin(longitude),
          1.626 * Math.sin(angle),
          1.626 * Math.cos(angle) * Math.cos(longitude),
        ));
      }
      globe.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), gridMaterial));
    }

    for (let meridian = 0; meridian < 180; meridian += 30) {
      const points: THREE.Vector3[] = [];
      const longitude = THREE.MathUtils.degToRad(meridian);
      for (let step = 0; step <= 100; step++) {
        const latitude = -Math.PI / 2 + (step / 100) * Math.PI;
        points.push(new THREE.Vector3(
          1.626 * Math.cos(latitude) * Math.sin(longitude),
          1.626 * Math.sin(latitude),
          1.626 * Math.cos(latitude) * Math.cos(longitude),
        ));
      }
      globe.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMaterial));
    }

    const starCount = 1800;
    const starPositions = new Float32Array(starCount * 3);
    for (let index = 0; index < starCount; index++) {
      const y = 1 - (2 * (index + 0.5)) / starCount;
      const ringRadius = Math.sqrt(1 - y * y);
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const offset = index * 3;
      starPositions[offset] = 1.646 * Math.cos(angle) * ringRadius;
      starPositions[offset + 1] = 1.646 * y;
      starPositions[offset + 2] = 1.646 * Math.sin(angle) * ringRadius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    globe.add(new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: "#e4e0ff", size: 0.018, transparent: true, opacity: 0.76, sizeAttenuation: true }),
    ));

    const marker = new THREE.Group();
    marker.add(new THREE.Mesh(
      new THREE.RingGeometry(0.042, 0.06, 48),
      new THREE.MeshBasicMaterial({ color: "#b1a7d2", side: THREE.DoubleSide, transparent: true, opacity: 0.82 }),
    ));
    marker.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.013, 16, 12),
      new THREE.MeshBasicMaterial({ color: "#d6cee8", transparent: true, opacity: 0.88 }),
    ));
    globe.add(marker);
    markerRef.current = marker;

    const updateMarker = (selectedRa: number, selectedDec: number) => {
      const normal = skyVector(selectedRa, selectedDec, 1.656);
      marker.position.copy(normal);
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    };
    updateMarker(ra, dec);

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      camera.position.z = Math.max(4.35, 4.35 / camera.aspect) / zoomRef.current;
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    let animationId = 0;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      globe.rotation.y += deltaX * 0.006;
      globe.rotation.x = THREE.MathUtils.clamp(globe.rotation.x + deltaY * 0.006, -0.9, 0.9);
      lastX = event.clientX;
      lastY = event.clientY;
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      pointerId = null;
    };

    const handleCanvasClick = (event: MouseEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(sphere)[0];
      if (!hit) return;

      const localPoint = globe.worldToLocal(hit.point.clone()).normalize();
      const selectedRa = (THREE.MathUtils.radToDeg(Math.atan2(localPoint.x, localPoint.z)) + 360) % 360;
      const selectedDec = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(localPoint.y, -1, 1)));
      onPickRef.current(selectedRa, selectedDec);
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerUp);
    renderer.domElement.addEventListener("click", handleCanvasClick);

    const render = () => {
      animationId = window.requestAnimationFrame(render);
      if (pointerId === null) globe.rotation.y += 0.00025;
      renderer.render(scene, camera);
    };
    render();

    return () => {
      window.cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      renderer.domElement.removeEventListener("click", handleCanvasClick);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      markerRef.current = null;
      cameraRef.current = null;
      globeRef.current = null;
      footprintGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = footprintGroupRef.current;
    if (!group) return;

    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose());
      }
    }

    for (const polygon of footprints) {
      if (polygon.length < 3) continue;
      const points: THREE.Vector3[] = [];
      for (let index = 0; index < polygon.length; index++) {
        const start = skyVector(polygon[index][0], polygon[index][1], 1).normalize();
        const endPoint = polygon[(index + 1) % polygon.length];
        const end = skyVector(endPoint[0], endPoint[1], 1).normalize();
        const segments = Math.max(2, Math.ceil(start.angleTo(end) * 32));
        for (let segment = 0; segment < segments; segment++) {
          points.push(interpolateSphere(start, end, segment / segments).multiplyScalar(1.635));
          points.push(interpolateSphere(start, end, (segment + 1) / segments).multiplyScalar(1.635));
        }
      }
      group.add(new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: "#b1a7d2", transparent: true, opacity: 0.48 }),
      ));
    }
  }, [footprints]);

  useEffect(() => {
    if (!markerRef.current) return;
    const normal = skyVector(ra, dec, 1.656);
    markerRef.current.position.copy(normal);
    markerRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    globeRef.current?.quaternion.setFromUnitVectors(
      skyVector(ra, dec, 1).normalize(),
      new THREE.Vector3(0, 0, 1),
    );
  }, [ra, dec]);

  useEffect(() => {
    zoomRef.current = zoom;
    if (cameraRef.current) {
      cameraRef.current.position.z = Math.max(4.35, 4.35 / cameraRef.current.aspect) / zoom;
    }
  }, [zoom]);

  return (
    <div className="globe-host" ref={hostRef}>
      {unavailable && <p className="globe-fallback">3D view is unavailable in this browser. Switch to the 2D map.</p>}
    </div>
  );
}