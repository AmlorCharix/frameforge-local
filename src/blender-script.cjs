function blenderScript(scene, outPath, mode = 'preview') {
  const payload = JSON.stringify({ scene, outPath, mode });
  return `import bpy, json, math
from mathutils import Vector

p=${JSON.stringify(payload)}
d=json.loads(p)
s=d['scene']
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

colors={
    'coral':(0.92,0.22,0.24,1), 'gold':(1,.62,.12,1),
    'mint':(.2,.82,.62,1), 'blue':(.18,.48,.94,1),
    'violet':(.58,.32,.88,1), 'white':(.9,.93,1,1)
}
for item in s['objects']:
    material=bpy.data.materials.new(item['name']+' material')
    material.diffuse_color=colors[item['color']]
    shader=material.node_tree.nodes.get('Principled BSDF') if material.node_tree else None
    if shader and shader.inputs.get('Base Color'):
        shader.inputs['Base Color'].default_value=colors[item['color']]
    shape=item['shape']
    location=item['start']
    size=item['size']
    if shape=='sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=size, location=location)
    elif shape=='cube':
        bpy.ops.mesh.primitive_cube_add(size=size*1.6, location=location)
    elif shape=='cone':
        bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=size, depth=size*1.8, location=location)
    elif shape=='torus':
        bpy.ops.mesh.primitive_torus_add(major_radius=size, minor_radius=size*.25, location=location)
    else:
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=size, depth=size*1.7, location=location)
    obj=bpy.context.object
    obj.name=item['name'][:64]
    obj.data.materials.append(material)
    obj.location=Vector(item['start'])
    obj.keyframe_insert(data_path='location', frame=1)
    # Both endpoints are needed for a full turn; a lone 360-degree key has no motion.
    obj.rotation_euler[2]=0
    obj.keyframe_insert(data_path='rotation_euler', frame=1)
    obj.location=Vector(item['end'])
    obj.keyframe_insert(data_path='location', frame=s['seconds']*s['fps'])
    obj.rotation_euler[2]=math.radians(360)
    obj.keyframe_insert(data_path='rotation_euler', frame=s['seconds']*s['fps'])

bpy.ops.object.camera_add(location=(9,-13,9))
camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens=42
bpy.context.scene.camera=camera
for location,power,size in [((4,-6,8),1600,7),((-5,-2,4),900,5)]:
    bpy.ops.object.light_add(type='AREA', location=location)
    light=bpy.context.object
    light.data.energy=power
    light.data.shape='DISK'
    light.data.size=size
    light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()

scene=bpy.context.scene
scene.frame_start=1
scene.frame_end=s['seconds']*s['fps']
scene.render.resolution_x=960
scene.render.resolution_y=540
scene.render.resolution_percentage=65
scene.render.image_settings.file_format='PNG'
scene.render.filepath=d['outPath']+'_review'
scene.world.color=(.055,.065,.09)
engine_ids={item.identifier for item in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items}
scene.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engine_ids else 'BLENDER_EEVEE'
scene.frame_set(max(1,scene.frame_end//2))
bpy.ops.render.render(write_still=True)

scene.render.resolution_percentage=100 if d['mode']=='final' else 65
scene.render.image_settings.file_format='PNG'
scene.render.filepath=d['outPath']+('_final_frame_' if d['mode']=='final' else '_preview_frame_')
bpy.ops.render.render(animation=True)
print('FRAMEFORGE_RENDER_DONE')
`;
}

module.exports = { blenderScript };
