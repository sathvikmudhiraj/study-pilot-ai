"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

type StudySceneProps = {
  fallback?: ReactNode;
};

function canUseWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

export function StudyScene({ fallback = null }: StudySceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const showFallback = () => {
      window.setTimeout(() => setFailed(true), 0);
    };
    const mount = mountRef.current;
    if (!mount || !canUseWebGL()) {
      showFallback();
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0.25, 8.2);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      showFallback();
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const group = new THREE.Group();
    group.position.set(-0.35, 0.12, 0);
    scene.add(group);

    const orbGeometry = new THREE.SphereGeometry(1.08, 56, 56);
    const orbMaterial = new THREE.MeshStandardMaterial({
      color: 0x31e6b2,
      metalness: 0.24,
      roughness: 0.26,
      emissive: 0x0c6b54,
      emissiveIntensity: 1.7,
      transparent: true,
      opacity: 0.94,
    });
    const orb = new THREE.Mesh(orbGeometry, orbMaterial);
    group.add(orb);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.12, 48, 48),
      new THREE.MeshBasicMaterial({
        color: 0x38f5c5,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.scale.setScalar(1.55);
    group.add(halo);

    const ringMaterials = [
      new THREE.MeshBasicMaterial({ color: 0xa7f3d0, transparent: true, opacity: 0.34, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.14, side: THREE.DoubleSide }),
    ];

    const rings = [1.86, 2.48, 3.08].map((radius, index) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.008, 8, 140), ringMaterials[index]);
      ring.rotation.x = Math.PI / (2.5 + index * 0.3);
      ring.rotation.y = index * 0.8;
      group.add(ring);
      return ring;
    });

    const panelMaterial = new THREE.MeshStandardMaterial({
      color: 0xeff6ff,
      metalness: 0.05,
      roughness: 0.5,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
    });
    const panelEdgeMaterial = new THREE.LineBasicMaterial({ color: 0xa7f3d0, transparent: true, opacity: 0.48 });
    const panelLineMaterial = new THREE.MeshBasicMaterial({ color: 0x9fffe2, transparent: true, opacity: 0.58 });
    const panelGeometry = new THREE.PlaneGeometry(1.28, 0.84);
    const panels = [
      { position: new THREE.Vector3(-1.15, 1.55, -0.28), rotation: [0.08, -0.52, -0.14] },
      { position: new THREE.Vector3(1.88, 1.08, -0.3), rotation: [-0.05, 0.44, 0.16] },
      { position: new THREE.Vector3(-0.92, -1.55, 0.08), rotation: [-0.08, 0.42, 0.12] },
      { position: new THREE.Vector3(2.1, -1.02, 0.05), rotation: [0.05, -0.4, -0.14] },
      { position: new THREE.Vector3(0.38, 2.18, -0.48), rotation: [0.18, 0.05, 0.08] },
    ].map((config) => {
      const panel = new THREE.Group();
      const card = new THREE.Mesh(panelGeometry, panelMaterial);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(panelGeometry), panelEdgeMaterial);
      panel.add(card, edge);

      [0.16, 0, -0.16].forEach((y, lineIndex) => {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(lineIndex === 0 ? 0.72 : 0.92, 0.02), panelLineMaterial);
        line.position.set(0, y, 0.01);
        panel.add(line);
      });

      panel.position.copy(config.position);
      panel.rotation.set(config.rotation[0], config.rotation[1], config.rotation[2]);
      group.add(panel);
      return panel;
    });

    const particlesGeometry = new THREE.BufferGeometry();
    const particleCount = 190;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) {
      const radius = 2.8 + Math.random() * 4.4;
      const angle = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 4.2;
      positions[i * 3 + 2] = Math.sin(angle) * radius - 1.4;
    }
    particlesGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particlesMaterial = new THREE.PointsMaterial({ color: 0xbdefff, size: 0.02, transparent: true, opacity: 0.55 });
    const particles = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particles);

    scene.add(new THREE.AmbientLight(0xc7f9ff, 0.9));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);
    const tealLight = new THREE.PointLight(0x15e6ad, 3.4, 11);
    tealLight.position.set(-2.3, -1, 3);
    scene.add(tealLight);
    const cyanLight = new THREE.PointLight(0x67e8f9, 1.9, 10);
    cyanLight.position.set(2.8, 1.2, 2.2);
    scene.add(cyanLight);

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let frameId = 0;
    const startedAt = performance.now();

    const animate = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      group.rotation.y = elapsed * 0.07;
      group.rotation.x = Math.sin(elapsed * 0.36) * 0.035;
      orb.rotation.y = elapsed * 0.22;
      halo.scale.setScalar(1.55 + Math.sin(elapsed * 1.4) * 0.06);
      rings.forEach((ring, index) => {
        ring.rotation.z = elapsed * (0.055 + index * 0.025);
        ring.rotation.y += 0.0009 + index * 0.0005;
      });
      panels.forEach((panel, index) => {
        panel.position.y += Math.sin(elapsed * 0.7 + index) * 0.0008;
      });
      particles.rotation.y = elapsed * 0.012;
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      renderer.dispose();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
      particlesGeometry.dispose();
      particlesMaterial.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <>
      {failed ? fallback : null}
      <div ref={mountRef} data-testid="study-3d-scene" className="pointer-events-none absolute inset-0 hidden h-full w-full opacity-80 sm:block lg:opacity-100" />
    </>
  );
}
